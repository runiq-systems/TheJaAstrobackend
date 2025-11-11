import { User } from '../models/user.js';
import { NotificationService } from './notification.service.js';
import logger from '../utils/logger.js';
import Call from '../models/calllogs/call.js';
import admin from '../utils/firabse.js';
import { CallNotificationService } from './notification.js';

export class WebRTCService {
    constructor(io) {
        this.io = io;
        this.users = new Map(); // userId -> Set(socketIds)
        this.activeCalls = new Map(); // userId -> callData
        this.pendingCalls = new Map(); // callKey -> callData
        this.callTimings = new Map(); // callKey -> timingData
        this.callTimeouts = new Map(); // callKey -> timeout
        this.iceBuffer = new Map(); // callKey -> [ { candidate, callerId, receiverId, callRecordId } ]

        this.CALL_TIMEOUT = 45000; // 45 seconds
        this.RING_TIMEOUT = 30000; // 30 seconds
        this.CONFLICT_WINDOW = 5000; // 5 seconds

        this.CALL_STATES = {
            INITIATED: 'INITIATED',
            RINGING: 'RINGING',
            CONNECTING: 'CONNECTING',
            CONNECTED: 'CONNECTED',
            ENDED: 'ENDED',
            CANCELLED: 'CANCELLED',
            REJECTED: 'REJECTED',
            MISSED: 'MISSED',
        };

        this.setupSocketHandlers();
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            logger.http(`User connected: ${socket.id}`, {
                ip: socket.handshake.address,
                userAgent: socket.handshake.headers['user-agent']
            });

            socket.on('join', this.handleJoin.bind(this, socket));
            socket.on('disconnect', this.handleDisconnect.bind(this, socket));
            socket.on('getOnlineStatus', this.handleGetOnlineStatus.bind(this, socket));

            // Call lifecycle
            socket.on('call', this.handleCall.bind(this, socket));
            socket.on('acceptCall', this.handleAcceptCall.bind(this, socket));
            socket.on('rejectCall', this.handleRejectCall.bind(this, socket));
            socket.on('endCall', this.handleEndCall.bind(this, socket));
            socket.on('cancelCall', this.handleCancelCall.bind(this, socket));
            socket.on('missedCall', this.handleMissedCall.bind(this, socket));

            // Signaling
            socket.on('offer', this.handleOffer.bind(this, socket));
            socket.on('answer', this.handleAnswer.bind(this, socket));
            socket.on('iceCandidate', this.handleIceCandidate.bind(this, socket));

            // Call features
            socket.on('toggleVideo', this.handleToggleVideo.bind(this, socket));
            socket.on('toggleAudio', this.handleToggleAudio.bind(this, socket));
            socket.on('toggleScreenShare', this.handleToggleScreenShare.bind(this, socket));
            socket.on('qualityMetrics', this.handleQualityMetrics.bind(this, socket));

            // User status
            socket.on('updateStatus', this.handleUpdateStatus.bind(this, socket));
        });
    }

    // ---------------- User management ----------------
    async handleJoin(socket, { userId }) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            const user = await User.findById(userId);
            if (!user) throw new Error('User not found');

            if (!this.users.has(userId)) this.users.set(userId, new Set());
            this.users.get(userId).add(socket.id);
            socket.userId = userId;

            await this.updateUserStatus(userId, 'Online');

            logger.info(`User ${userId} joined with socket ${socket.id}`, {
                totalSockets: this.users.get(userId).size,
                username: user.fullName || user.name
            });

            socket.emit('joinSuccess', {
                userId,
                socketId: socket.id,
                userStatus: user.status,
                isOnline: user.isOnline
            });

            this.broadcastUserStatus(userId, 'Online', user);
        } catch (error) {
            logger.error(`Join error for user ${userId}:`, error);
            socket.emit('error', {
                type: 'JOIN_ERROR',
                message: error.message
            });
        }
    }

    async handleDisconnect(socket) {
        try {
            const userId = socket.userId;
            if (!userId) return;

            logger.info(`User ${userId} disconnected (socket: ${socket.id})`);

            const userSockets = this.users.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    this.users.delete(userId);
                    await this.updateUserStatus(userId, 'offline');
                }
            }

            await this.handleCallDisconnection(userId, socket);
            this.cleanupPendingCallsBySocket(socket.id);

            logger.debug(`Disconnect processing completed for user ${userId}`);
        } catch (error) {
            logger.error('Disconnect handler error:', error);
        }
    }

    // ---------------- Call management (unchanged logic, improved fields) ----------------
    async handleCall(socket, { callerId, receiverId, callType = "AUDIO" }) {
        let callKey;
        try {
            if (!callerId || !receiverId) throw new Error("Caller and receiver IDs are required");
            if (callerId === receiverId) throw new Error("You cannot call yourself");

            callKey = this.generateCallKey(callerId, receiverId);
            await this.validateUserAvailability(callerId, receiverId, socket);

            if (this.isUserInCall(callerId) || this.isUserInCall(receiverId)) {
                socket.emit("userBusy", { userId: receiverId, message: "User is currently in another call" });
                return;
            }

            const callRecord = await this.createCallRecord({
                callerId,
                receiverId,
                callType,
                socketId: socket.id,
                status: "INITIATED",
            });

            this.setupPendingCall(callKey, {
                callerId,
                receiverId,
                callType,
                callRecordId: callRecord._id,
                socketId: socket.id,
                timestamp: Date.now(),
                status: "INITIATED",
            });

            this.setActiveCallState(callerId, receiverId, callKey);
            await callRecord.markRinging();

            // Get caller info for notification
            const caller = await User.findById(callerId);

            // ✅ Send incoming call notification
            await CallNotificationService.sendCallNotification({
                targetUserId: receiverId,
                title: "Incoming Call",
                message: `${caller?.name || "Unknown"} is calling you`,
                type: "incoming",
                fromUserId: callerId,
                fromName: caller?.name,
                fromAvatar: caller?.profilePicture,
                fromEmail: caller?.email,
                screen: "IncomingCall",
                callType: callType.toLowerCase(),
                callRecordId: callRecord._id.toString()
            });



            // ✅ Emit socket event for real-time UI
            this.emitToUser(receiverId, 'incomingCall', {
                callerId,
                receiverId,
                callerName: caller?.name,
                callerPicture: caller?.profilePicture,
                callType,
                callRecordId: callRecord._id,
                timestamp: Date.now()
            });

            this.setRingTimeout(callKey, callerId, receiverId, callRecord._id);
            logger.info(`[📞 CALL_SETUP_COMPLETE] ${callKey}`);

        } catch (error) {
            logger.error(`[❌ CALL_ERROR] ${callKey || "UNKNOWN"}:`, error);
            this.cleanupCallResources(callKey, callerId, receiverId, socket);
            socket.emit("callError", { message: "Failed to initiate call", details: error.message });
        }
    }

    setRingTimeout(callKey, callerId, receiverId, callRecordId, timeoutMs = 30000) {
        setTimeout(async () => {
            const pending = this.getPendingCall(callKey);
            if (pending && pending.status === "INITIATED") {
                logger.info(`⏰ Call timed out (no answer): ${callKey}`);
                await this.updateCallStatus(callRecordId, "MISSED");
                this.cleanupCallResources(callKey, callerId, receiverId);

                // Notify both parties
                this.io.to(pending.socketId).emit("callMissed", { receiverId });
                this.io.to(receiverId).emit("callMissed", { callerId });

                // Send missed call push notification
                await sendCallNotification({
                    targetUserId: receiverId,
                    title: "Missed Call",
                    message: `You missed a call from ${callerId}`,
                    type: "missed",
                    fromUserId: callerId,
                    fromName: "Missed Call",
                    screen: "CallHistory",
                });
            }
        }, timeoutMs);
    }



    async handleAcceptCall(socket, { receiverId, callerId, callRecordId }) {
        try {
            const callKey = this.generateCallKey(callerId, receiverId);
            logger.info(`[CALL_ACCEPT] ${receiverId} accepting call from ${callerId}`, { callRecordId, socketId: socket.id });

            const callRecord = await Call.findById(callRecordId);
            if (!callRecord) throw new Error('Call record not found');

            this.clearCallTimeout(callKey);

            callRecord.status = 'CONNECTED';
            callRecord.connectTime = new Date();
            if (!callRecord.socketIds) callRecord.socketIds = {};
            callRecord.socketIds.receiver = socket.id;
            await callRecord.save();

            this.callTimings.set(callKey, {
                startTime: new Date(),
                callRecordId: callRecord._id,
                callerId,
                receiverId,
                connectTime: callRecord.connectTime
            });

            const [callerUser, receiverUser] = await Promise.all([
                User.findById(callerId).select('name fullName profilePicture'),
                User.findById(receiverId).select('name fullName profilePicture')
            ]);

            const payloadForCaller = {
                callerId,
                receiverId,
                receiverSocketId: socket.id,
                receiverName: receiverUser?.fullName,
                receiverPicture: receiverUser?.profilePicture,
                callRecordId: callRecord._id,
                callType: callRecord.callType,
                timestamp: new Date()
            };

            const payloadForReceiver = {
                callerId,
                callerSocketId: callRecord.socketIds?.caller || null,
                callerName: callerUser?.fullName,
                callerPicture: callerUser?.profilePicture,
                callRecordId: callRecord._id,
                callType: callRecord.callType,
                timestamp: new Date()
            };

            const sentToCaller = this.emitToUser(callerId, 'callAccepted', payloadForCaller);
            if (!sentToCaller) logger.warn(`[EMIT_WARN] callAccepted NOT delivered to caller ${callerId}.`);

            const sentToReceiver = this.emitToUser(receiverId, 'callAccepted', payloadForReceiver);
            if (!sentToReceiver) logger.warn(`[EMIT_WARN] callAccepted NOT delivered to receiver ${receiverId}.`);

            this.emitToUser(callerId, 'stopCallerTune', { callerId });
            this.pendingCalls.delete(callKey);

            logger.info(`[CALL_CONNECTED] ${callKey}`, { callRecordId: callRecord._id, connectTime: callRecord.connectTime });
        } catch (error) {
            logger.error(`Call accept error:`, error);
            socket.emit('callError', { message: 'Failed to accept call', details: error.message });
        }
    }

    async handleRejectCall(socket, { receiverId, callerId, callRecordId, reason = "user_busy" }) {
        try {
            const callKey = this.generateCallKey(callerId, receiverId);

            const callRecord = await Call.findByIdAndUpdate(
                callRecordId,
                { status: "REJECTED", endTime: new Date(), feedback: reason },
                { new: true }
            );

            const receiver = await User.findById(receiverId);

            // ✅ Send call rejected notification to caller
            await CallNotificationService.sendCallNotification({
                targetUserId: callerId,
                title: "Call Rejected",
                message: `${receiver?.name || "User"} rejected your call`,
                type: "rejected",
                fromUserId: receiverId,
                fromName: receiver?.name,
                fromAvatar: receiver?.profilePicture,
                fromEmail: receiver?.email,
                screen: "CallHistory",
                callRecordId: callRecord._id.toString()
            });

            this.emitToUser(callerId, "callRejected", {
                receiverId,
                callRecordId: callRecord._id,
                reason,
                timestamp: new Date(),
            });

            this.emitToUser(callerId, "stopCallerTune", { callerId });

            this.cleanupCallResources(callKey, callerId, receiverId, socket);
            logger.info(`[CALL_REJECTED] ${callKey}`);
        } catch (error) {
            logger.error(`Call reject error:`, error);
            socket.emit("callError", { message: "Failed to reject call", details: error.message });
        }
    }

    async handleCancelCall(socket, { callerId, receiverId, callRecordId }) {
        const callKey = this.generateCallKey(callerId, receiverId);

        try {
            if (!callRecordId) callRecordId = this.getCallRecordId(callKey);
            if (!callRecordId) throw new Error("Call record ID not found");

            const callRecord = await Call.findByIdAndUpdate(
                callRecordId,
                { status: "CANCELLED", endTime: new Date() },
                { new: true }
            );

            const caller = await User.findById(callerId);

            // ✅ Send call cancelled notification to receiver
            await CallNotificationService.sendCallNotification({
                targetUserId: receiverId,
                title: "Call Cancelled",
                message: `${caller?.name || "Caller"} cancelled the call`,
                type: "cancelled",
                fromUserId: callerId,
                fromName: caller?.name,
                fromAvatar: caller?.profilePicture,
                fromEmail: caller?.email,
                screen: "CallList",
                callRecordId: callRecord._id.toString()
            });

            this.emitToUser(receiverId, "callCancelled", { callerId, callRecordId: callRecord._id });
            this.emitToUser(receiverId, "stopIncomingCall", { callerId, callRecordId: callRecord._id });

            logger.info(`[CALL_CANCELLED] ${callKey}`);
        } catch (error) {
            logger.error(`[CALL_CANCEL_ERROR] ${callerId} → ${receiverId}:`, error);
            socket.emit("callError", { message: "Failed to cancel call", details: error.message });
        } finally {
            this.cleanupCallResources(callKey, callerId, receiverId, socket);
        }
    }

    async handleMissedCall(socket, { receiverId, callerId, callRecordId }) {
        try {
            const callKey = this.generateCallKey(callerId, receiverId);

            const callRecord = await Call.findByIdAndUpdate(
                callRecordId,
                { status: "MISSED", endTime: new Date() },
                { new: true }
            );

            const caller = await User.findById(callerId);

            // ✅ Send missed call notification to receiver
            await CallNotificationService.sendCallNotification({
                targetUserId: receiverId,
                title: "Missed Call",
                message: `You missed a call from ${caller?.name || "Unknown Caller"}`,
                type: "missed",
                fromUserId: callerId,
                fromName: caller?.name,
                fromAvatar: caller?.profilePicture,
                fromEmail: caller?.email,
                screen: "CallHistory",
                callRecordId: callRecord._id.toString()
            });

            this.emitToUser(callerId, "callMissed", { receiverId, callRecordId });
            this.cleanupCallResources(callKey, callerId, receiverId, socket);
            logger.info(`[CALL_MISSED] ${callKey}`);
        } catch (error) {
            logger.error(`Missed call error:`, error);
            socket.emit("callError", { message: "Failed to process missed call", details: error.message });
        }
    }

    async handleEndCall(socket, { callerId, receiverId, callRecordId, reason = 'normal' }) {
        try {
            const callKey = this.generateCallKey(callerId, receiverId);

            logger.info(`[CALL_END] ${callerId} ending call with ${receiverId}`, {
                callRecordId,
                reason,
                socketId: socket.id
            });

            // Calculate duration and update call record
            const callTiming = this.callTimings.get(callKey);
            const endTime = new Date();
            let duration = 0;
            let callDuration = 0;

            if (callTiming) {
                duration = Math.round((endTime - callTiming.startTime) / 1000);
                if (callTiming.connectTime) {
                    callDuration = Math.round((endTime - callTiming.connectTime) / 1000);
                }
            }

            const callRecord = await Call.findByIdAndUpdate(
                callRecordId,
                {
                    endTime,
                    duration,
                    status: 'COMPLETED'
                },
                { new: true }
            ).populate('userId', 'name fullName')
                .populate('astrologerId', 'name fullName');

            const [callerUser, receiverUser] = await Promise.all([
                User.findById(callerId).select('name fullName profilePicture'),
                User.findById(receiverId).select('name fullName profilePicture')
            ]);

            // ✅ Send call ended notification to both parties
            await CallNotificationService.sendCallNotification({
                targetUserId: receiverId,
                title: "Call Ended",
                message: `Call with ${callerUser?.name || "Caller"} ended`,
                type: "ended",
                fromUserId: callerId,
                fromName: callerUser?.name,
                fromAvatar: callerUser?.profilePicture,
                fromEmail: callerUser?.email,
                screen: "CallHistory",
                callType: callRecord.callType.toLowerCase(),
                callRecordId: callRecord._id.toString(),
                duration: callDuration
            });

            await CallNotificationService.sendCallNotification({
                targetUserId: callerId,
                title: "Call Ended",
                message: `Call with ${receiverUser?.name || "Receiver"} ended`,
                type: "ended",
                fromUserId: receiverId,
                fromName: receiverUser?.name,
                fromAvatar: receiverUser?.profilePicture,
                fromEmail: receiverUser?.email,
                screen: "CallHistory",
                callType: callRecord.callType.toLowerCase(),
                callRecordId: callRecord._id.toString(),
                duration: callDuration
            });

            // Notify both parties via socket
            this.emitToUser(receiverId, 'callEnded', {
                callerId,
                receiverId,
                duration: callDuration,
                totalDuration: duration,
                reason,
                timestamp: endTime,
                callRecordId: callRecord._id
            });

            this.emitToUser(callerId, 'callEnded', {
                callerId,
                receiverId,
                duration: callDuration,
                totalDuration: duration,
                reason,
                timestamp: endTime,
                callRecordId: callRecord._id
            });

            // Cleanup resources
            this.cleanupCallResources(callKey, callerId, receiverId, socket);

            logger.info(`[CALL_ENDED] ${callKey} lasted ${callDuration}s (total: ${duration}s)`, {
                callRecordId: callRecord._id,
                reason
            });

        } catch (error) {
            logger.error(`Call end error:`, error);
            socket.emit('callError', {
                message: 'Failed to end call',
                details: error.message
            });
        }
    }

    // Enhanced ring timeout with notification
    setRingTimeout(callKey, callerId, receiverId, callRecordId, timeoutMs = 30000) {
        const timeout = setTimeout(async () => {
            const pending = this.getPendingCall(callKey);
            if (pending && pending.status === "INITIATED") {
                logger.info(`⏰ Call timed out (no answer): ${callKey}`);

                const callRecord = await Call.findByIdAndUpdate(
                    callRecordId,
                    { status: "MISSED", endTime: new Date() },
                    { new: true }
                );

                const caller = await User.findById(callerId);

                // ✅ Send missed call notification
                await CallNotificationService.sendCallNotification({
                    targetUserId: receiverId,
                    title: "Missed Call",
                    message: `You missed a call from ${caller?.name || "Unknown Caller"}`,
                    type: "missed",
                    fromUserId: callerId,
                    fromName: caller?.name,
                    fromAvatar: caller?.profilePicture,
                    fromEmail: caller?.email,
                    screen: "CallHistory",
                    callRecordId: callRecord._id.toString()
                });

                // Notify both parties
                this.emitToUser(callerId, "callMissed", { receiverId, callRecordId });
                this.emitToUser(receiverId, "stopIncomingCall", { callerId, callRecordId });

                this.cleanupCallResources(callKey, callerId, receiverId);
            }
        }, timeoutMs);

        this.callTimeouts.set(callKey, timeout);
    }







    // ---------- Signaling helpers ----------
    generateCallKey(a, b) {
        return [a, b].sort().join('_');
    }

    // Single, consistent emitToUser implementation
    emitToUser(userId, event, payload) {
        const sockets = this.users.get(userId);
        if (!sockets || sockets.size === 0) {
            logger.warn(`[EMIT] User offline – ${event}`, { userId, payload });
            return false;
        }
        sockets.forEach(sid => this.io.to(sid).emit(event, payload));
        return true;
    }

    validateSDP(type, data) {
        if (!data || typeof data.sdp !== 'string' || !data.sdp.includes('m=')) {
            throw new Error(`Invalid ${type} SDP`);
        }
    }

    validateIceCandidate(candidate) {
        if (!candidate || typeof candidate.candidate !== 'string') {
            throw new Error('Invalid ICE candidate');
        }
    }

    emitSignalingError(socket, type, err, callRecordId) {
        const payload = {
            type,
            code: err.code || 'UNKNOWN',
            message: err.message || 'Signaling error',
            callRecordId,
            timestamp: Date.now(),
        };
        logger.error(`[SIGNALING_ERROR] ${type}`, payload);
        socket.emit('signalingError', payload);
    }
    // -------- OFFER --------



    async handleOffer(socket, { offer, callerId, receiverId }) {
        try {
            console.log(`User ${callerId} sending offer to User ${receiverId}`);

            // Update active call mapping
            this.activeCalls.set(callerId, receiverId);
            this.activeCalls.set(receiverId, callerId);

            if (this.users.has(receiverId)) {
                const receiverSockets = this.users.get(receiverId);

                for (const socketId of receiverSockets) {
                    socket.to(socketId).emit('offer', { offer, callerId });
                }

                console.log(`Offer sent to User ${receiverId}`);
            } else {
                socket.emit('userUnavailable', { receiverId });
                console.warn(`User ${receiverId} not found during offer`);
            }
        } catch (error) {
            console.error(`Error in handleOffer: ${error.message}`);
            socket.emit('callError', { message: 'Failed to process offer' });
        }
    }


    // -------- ANSWER --------
    async handleAnswer(socket, { answer, receiverId, callerId }) {
        try {
            console.log(`User ${receiverId} sending answer to User ${callerId}`);

            // Example: Future async DB call can go here
            // await CallModel.updateOne({ callerId, receiverId }, { status: 'ANSWERED' });

            if (this.users.has(callerId)) {
                const callerSockets = this.users.get(callerId);

                for (const socketId of callerSockets) {
                    socket.to(socketId).emit('answer', { answer, receiverId });
                }

                console.log(`Answer sent to User ${callerId}`);
            } else {
                socket.emit('userUnavailable', { callerId });
                console.warn(`User ${callerId} not found during answer`);
            }
        } catch (error) {
            console.error(`Error in handleAnswer: ${error.message}`);
            socket.emit('callError', { message: 'Failed to process answer' });
        }
    }


    // -------- ICE candidate handler (robust + normalize incoming keys) --------
    async handleIceCandidate(socket, { candidate, callerId, receiverId }) {
        try {
            console.log('ICE candidate received:', { callerId, receiverId });

            // Validate ICE candidate
            if (!candidate) {
                console.warn('Invalid ICE candidate received');
                socket.emit('error', {
                    type: 'ICE_CANDIDATE_ERROR',
                    message: 'Invalid ICE candidate',
                });
                return;
            }

            // Check if receiver exists
            if (!this.users.has(receiverId)) {
                console.warn(`Receiver ${receiverId} not found in users`);
                socket.emit('error', {
                    type: 'ICE_CANDIDATE_ERROR',
                    message: 'Receiver not found',
                });
                return;
            }

            // Get all receiver socket IDs
            const receiverSockets = this.users.get(receiverId);
            if (!receiverSockets || receiverSockets.size === 0) {
                console.warn(`No active sockets for receiver ${receiverId}`);
                socket.emit('error', {
                    type: 'ICE_CANDIDATE_ERROR',
                    message: 'Receiver not connected',
                });
                return;
            }

            // Forward ICE candidate to all receiver sockets
            for (const socketId of receiverSockets) {
                socket.to(socketId).emit('iceCandidate', {
                    candidate,
                    callerId,
                    timestamp: Date.now(),
                });
                console.log(`ICE candidate forwarded to ${receiverId} via socket ${socketId}`);
            }

        } catch (error) {
            console.error('Error in handleIceCandidate:', error.message);
            socket.emit('error', {
                type: 'ICE_CANDIDATE_ERROR',
                message: 'Failed to process ICE candidate',
            });
        }
    }
    // Flush buffered ICE (to be called when remote description is set on target user)
    flushBufferedIce(callKey, targetUserId) {
        const buf = this.iceBuffer.get(callKey) || [];
        if (!buf.length) return;

        buf.forEach(item => {
            this.emitToUser(targetUserId, 'iceCandidate', {
                candidate: item.candidate,
                callerId: item.callerId,
                receiverId: item.receiverId,
                callRecordId: item.callRecordId,
                timestamp: Date.now(),
            });
        });

        this.iceBuffer.delete(callKey);
        logger.debug('[ICE] Flushed buffered candidates', { callKey, count: buf.length });
    }

    // ---------- Utility / existing functions (kept mostly the same, with small improvements) ----------
    async validateUserAvailability(callerId, receiverId, socket) {
        const [caller, receiver] = await Promise.all([User.findById(callerId), User.findById(receiverId)]);
        if (!caller || !receiver) throw new Error('User not found');

        if (receiver.userStatus === 'InActive' || receiver.isSuspended) {
            socket.emit('receiverUnavailable', { message: 'User is currently unavailable' });
            throw new Error('Receiver unavailable');
        }
        if (caller.isSuspended) {
            socket.emit('callerSuspended', { message: 'Your account is suspended' });
            throw new Error('Caller account suspended');
        }
        return { caller, receiver };
    }

    async createCallRecord(callData) {
        const callRecord = new Call({
            userId: callData.callerId,
            astrologerId: callData.receiverId,
            callType: callData.callType,
            callDirection: callData.callDirection,
            status: 'INITIATED',
            socketIds: { caller: callData.socketId },
            videoEnabled: callData.callType === 'VIDEO',
            audioEnabled: true
        });
        return await callRecord.save();
    }

    setupPendingCall(callKey, callData) {
        this.pendingCalls.set(callKey, callData);
    }

    getCallRecordId(callKey) {
        const pendingCall = this.pendingCalls.get(callKey);
        return pendingCall ? pendingCall.callRecordId : null;
    }

    setActiveCallState(callerId, receiverId, callKey) {
        // Save both entries for quick lookups, with otherUserId for easier disconnection handling
        this.activeCalls.set(callerId, {
            callKey,
            callerId,
            receiverId,
            otherUserId: receiverId,
            status: this.CALL_STATES.CONNECTING,
            pc: {}
        });
        this.activeCalls.set(receiverId, {
            callKey,
            callerId,
            receiverId,
            otherUserId: callerId,
            status: this.CALL_STATES.RINGING,
            pc: {}
        });
    }

    async notifyReceiver(callerId, receiverId, callType, callRecord) {
        const caller = await User.findById(callerId).select('name fullName profilePicture');
        this.emitToUser(receiverId, 'incomingCall', {
            callerId,
            receiverId,
            callerName: caller.fullName,
            callerPicture: caller.profilePicture,
            callType,
            callRecordId: callRecord._id,
            timestamp: Date.now()
        });
        this.emitToUser(callerId, 'playCallerTune', { callerId });
        await NotificationService.sendIncomingCallNotification(receiverId, caller, callRecord._id);
        logger.debug(`[RECEIVER_NOTIFIED] Receiver ${receiverId} notified`, { callRecordId: callRecord._id });
    }

    setRingTimeout(callKey, callerId, receiverId, callRecordId) {
        const timeout = setTimeout(async () => {
            logger.info(`[RING_TIMEOUT] Call ${callKey} timed out`);
            await Call.findByIdAndUpdate(callRecordId, { status: 'MISSED', endTime: new Date() });
            this.emitToUser(callerId, 'callTimeout', { receiverId, callRecordId, message: 'Call timed out' });
            this.emitToUser(receiverId, 'stopIncomingCall', { callerId, callRecordId });
            this.cleanupCallResources(callKey, callerId, receiverId);
        }, this.RING_TIMEOUT);
        this.callTimeouts.set(callKey, timeout);
    }

    clearCallTimeout(callKey) {
        const timeout = this.callTimeouts.get(callKey);
        if (timeout) {
            clearTimeout(timeout);
            this.callTimeouts.delete(callKey);
        }
    }

    isUserInCall(userId) {
        return this.activeCalls.has(userId) ||
            Array.from(this.pendingCalls.values()).some(call => call.callerId === userId || call.receiverId === userId);
    }

    hasCallConflict(callKey) {
        const existingCall = this.pendingCalls.get(callKey);
        if (!existingCall) return false;
        const timeSinceCall = Date.now() - existingCall.timestamp;
        return timeSinceCall < this.CONFLICT_WINDOW;
    }

    findUserIdBySocket(socketId) {
        for (const [userId, socketIds] of this.users.entries()) {
            if (socketIds.has(socketId)) return userId;
        }
        return null;
    }

    cleanupCallResources(callKey, callerId, receiverId, socket = null) {
        this.clearCallTimeout(callKey);
        this.pendingCalls.delete(callKey);
        this.activeCalls.delete(callerId);
        this.activeCalls.delete(receiverId);
        this.callTimings.delete(callKey);
        this.callTimeouts.delete(callKey);
        this.iceBuffer.delete(callKey);
        logger.debug(`[CLEANUP] Resources cleaned for ${callKey}`, { callerId, receiverId });
    }

    cleanupPendingCallsBySocket(socketId) {
        for (const [callKey, callData] of this.pendingCalls.entries()) {
            if (callData.socketId === socketId) {
                this.pendingCalls.delete(callKey);
                this.clearCallTimeout(callKey);
                logger.debug(`[CLEANUP] Removed pending call ${callKey} for socket ${socketId}`);
            }
        }
    }



    // Call Features
    handleToggleVideo(socket, { callRecordId, enabled, userId }) {
        try {
            const call = this.findCallBySocket(socket.id);
            if (call) {
                const otherUserId = call.userId.toString() === userId ?
                    call.astrologerId : call.userId;

                this.emitToUser(otherUserId, 'videoToggled', {
                    enabled,
                    byUserId: userId,
                    callRecordId
                });

                logger.debug(`[VIDEO_TOGGLED] User ${userId} ${enabled ? 'enabled' : 'disabled'} video`, {
                    callRecordId
                });
            }
        } catch (error) {
            logger.error(`Toggle video error:`, error);
        }
    }

    handleToggleAudio(socket, { callRecordId, enabled, userId }) {
        try {
            const call = this.findCallBySocket(socket.id);
            if (call) {
                const otherUserId = call.userId.toString() === userId ?
                    call.astrologerId : call.userId;

                this.emitToUser(otherUserId, 'audioToggled', {
                    enabled,
                    byUserId: userId,
                    callRecordId
                });

                logger.debug(`[AUDIO_TOGGLED] User ${userId} ${enabled ? 'enabled' : 'disabled'} audio`, {
                    callRecordId
                });
            }
        } catch (error) {
            logger.error(`Toggle audio error:`, error);
        }
    }

    handleToggleScreenShare(socket, { callRecordId, enabled, userId }) {
        try {
            const call = this.findCallBySocket(socket.id);
            if (call) {
                const otherUserId = call.userId.toString() === userId ?
                    call.astrologerId : call.userId;

                this.emitToUser(otherUserId, 'screenShareToggled', {
                    enabled,
                    byUserId: userId,
                    callRecordId
                });

                logger.debug(`[SCREEN_SHARE_TOGGLED] User ${userId} ${enabled ? 'started' : 'stopped'} screen share`, {
                    callRecordId
                });
            }
        } catch (error) {
            logger.error(`Toggle screen share error:`, error);
        }
    }

    handleQualityMetrics(socket, { callRecordId, metrics, userId }) {
        try {
            // Store quality metrics for analytics
            logger.debug(`[QUALITY_METRICS] User ${userId} quality metrics`, {
                callRecordId,
                metrics
            });

            // You can store these in the call record or a separate analytics service
            Call.findByIdAndUpdate(callRecordId, {
                qualityMetrics: metrics,
                networkQuality: this.calculateNetworkQuality(metrics)
            }).catch(err => logger.error('Error updating quality metrics:', err));

        } catch (error) {
            logger.error(`Quality metrics handling error:`, error);
        }
    }


    async handleCallDisconnection(userId, socket) {
        const activeCall = this.activeCalls.get(userId);
        if (!activeCall) return;

        const otherUserId = activeCall.otherUserId || (activeCall.callerId === userId ? activeCall.receiverId : activeCall.callerId);
        const callKey = activeCall.callKey;

        try {
            const callTiming = this.callTimings.get(callKey);
            if (callTiming) {
                const endTime = new Date();
                const duration = Math.round((endTime - callTiming.startTime) / 1000);
                let callDuration = 0;
                if (callTiming.connectTime) callDuration = Math.round((endTime - callTiming.connectTime) / 1000);

                await Call.findByIdAndUpdate(callTiming.callRecordId, {
                    endTime,
                    duration,
                    status: 'DISCONNECTED',
                    disconnectedBy: userId
                });

                this.emitToUser(otherUserId, 'callEnded', {
                    reason: 'disconnected',
                    disconnectedBy: userId,
                    duration: callDuration,
                    totalDuration: duration,
                    callRecordId: callTiming.callRecordId
                });

                logger.info(`[CALL_DISCONNECTED] User ${userId} disconnected from call`, { callKey, callDuration, totalDuration: duration });
            }

            this.cleanupCallResources(callKey, userId, otherUserId);
        } catch (error) {
            logger.error(`Call disconnection handling error:`, error);
        }
    }

    // ---------------- Broadcast User Status ----------------
    async broadcastUserStatus(userId, status, userData = {}) {
        try {
            const payload = {
                userId,
                status,
                isOnline: status === 'Online',
                lastSeen: userData.lastSeen || new Date(),
                name: userData.fullName || userData.name,
                profilePicture: userData.profilePicture || null
            };

            // Broadcast to all connected users
            this.io.emit('userStatusUpdated', payload);

            logger.info(`[USER_STATUS_BROADCAST] ${userId} -> ${status}`, {
                name: userData.fullName || userData.name,
                isOnline: payload.isOnline
            });
        } catch (err) {
            logger.error(`[BROADCAST_STATUS_ERROR] user ${userId}`, err);
        }
    }

    async updateUserStatus(userId, status) {
        try {
            const updateData = { status, isOnline: status === 'Online' };
            if (status === 'offline') updateData.lastSeen = new Date();
            const user = await User.findByIdAndUpdate(userId, updateData, { new: true }).select('name fullName profilePicture status isOnline lastSeen');
            if (user) {
                this.broadcastUserStatus(userId, user.status, user);
                logger.debug(`User ${userId} status updated to ${status}`);
            }
        } catch (error) {
            logger.error(`Status update error for user ${userId}:`, error);
        }
    }

    calculateNetworkQuality(metrics) {
        if (!metrics) return 'UNKNOWN';
        const { packetLoss, jitter, latency } = metrics;
        if (packetLoss > 10 || jitter > 50 || latency > 300) return 'POOR';
        else if (packetLoss > 5 || jitter > 20 || latency > 150) return 'FAIR';
        else if (packetLoss > 2 || jitter > 10 || latency > 100) return 'GOOD';
        else return 'EXCELLENT';
    }

    findCallBySocket(socketId) {
        // Optional: implement mapping socket -> call
        return null;
    }

    async handleGetOnlineStatus(socket, { userId }) {
        try {
            const user = await User.findById(userId).select('status isOnline lastSeen');
            if (user) socket.emit('onlineStatus', { userId, status: user.status, isOnline: user.isOnline, lastSeen: user.lastSeen });
        } catch (error) {
            logger.error(`Get online status error:`, error);
        }
    }

    async handleUpdateStatus(socket, { status }) {
        try {
            const userId = socket.userId;
            if (!userId) return;
            await this.updateUserStatus(userId, status);
            socket.emit('statusUpdated', { status });
        } catch (error) {
            logger.error(`Update status error:`, error);
            socket.emit('error', { type: 'STATUS_UPDATE_ERROR', message: error.message });
        }
    }

    getServiceStats() {
        return {
            connectedUsers: this.users.size,
            activeCalls: this.activeCalls.size,
            pendingCalls: this.pendingCalls.size,
            callTimings: this.callTimings.size,
            userQueue: Array.from(this.users.entries()).map(([userId, sockets]) => ({ userId, socketCount: sockets.size }))
        };
    }
}

export const setupWebRTC = (io) => {
    return new WebRTCService(io);
};


export async function sendCallNotification({
    targetUserId,
    title,
    message,
    type, // 'incoming', 'accepted', 'rejected', 'missed', 'cancelled'
    fromUserId,
    fromName,
    fromAvatar,
    fromEmail,
    screen = "IncomingCall",
    callType = "audio",
}) {
    try {
        const user = await User.findById(targetUserId);
        if (!user || !user.deviceToken) {
            logger.warn(`⚠️ No device token for user: ${targetUserId}`);
            return;
        }

        const timestamp = Math.floor(Date.now() / 1000).toString();

        const payload = {
            token: user.deviceToken,
            android: {
                priority: "high",
                notification: {
                    sound: "default",
                    channelId: "calls",  // must exist in app
                    visibility: "public",
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: "default",
                        badge: 1,
                        contentAvailable: true,
                        mutableContent: true,
                    },
                },
            },
            data: {
                type,
                screen,
                call_type: callType,
                caller_id: fromUserId,
                caller_name: fromName || "Unknown Caller",
                caller_avatar: fromAvatar || "https://investogram.ukvalley.com/avatars/default.png",
                caller_email: fromEmail || "N/A",
                timestamp,
                sound: "default",
                vibration: "true",
                params: JSON.stringify({
                    user_id: fromUserId,
                    username: fromName,
                    email: fromEmail,
                    imageurl: fromAvatar,
                    act_tab: type === "rejected" ? "1" : "0",
                    navigate_to: screen,
                    call_type: callType,
                }),
            },
        };

        if (type !== "incoming") {
            payload.notification = {
                title: title || "Call Update",
                body: message || "Call event received.",
            };
        }

        const response = await admin.messaging().send(payload);
        logger.info(`✅ [FCM] ${type} notification sent → ${targetUserId} (${response})`);
    } catch (error) {
        logger.error(`❌ Error sending ${type} notification:`, error);
    }
}


