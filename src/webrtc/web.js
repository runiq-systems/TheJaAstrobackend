import { User } from '../models/user.js';
// import { NotificationService } from './notification.service.js';
import logger from '../utils/logger.js';
import Call from '../models/calllogs/call.js';
export class WebRTCService {
    constructor(io) {
        this.io = io;
        this.users = new Map(); // userId -> Set(socketIds)
        this.activeCalls = new Map(); // userId -> callData
        this.pendingCalls = new Map(); // callKey -> callData
        this.callTimings = new Map(); // callKey -> timingData
        this.callTimeouts = new Map(); // callKey -> timeout
        this.iceBuffer = new Map();

        this.CALL_TIMEOUT = 45000; // 45 seconds
        this.RING_TIMEOUT = 30000; // 30 seconds
        this.CONFLICT_WINDOW = 5000; // 5 seconds
        // ← MOVE CALL_STATES HERE (MUST BE BEFORE setupSocketHandlers)
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

            // User management
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

            // WebRTC signaling
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

    // User Management
    async handleJoin(socket, { userId }) {
        try {
            if (!userId) {
                throw new Error('User ID is required');
            }

            // Validate user exists
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Add user to connected users
            if (!this.users.has(userId)) {
                this.users.set(userId, new Set());
            }
            this.users.get(userId).add(socket.id);

            // Store userId in socket for easy access
            socket.userId = userId;

            // Update user status
            await this.updateUserStatus(userId, 'Online');

            logger.info(`User ${userId} joined with socket ${socket.id}`, {
                totalSockets: this.users.get(userId).size,
                username: user.fullName || user.fullName
            });

            socket.emit('joinSuccess', {
                userId,
                socketId: socket.id,
                userStatus: user.status,
                isOnline: user.isOnline
            });

            // Notify others about user coming online
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

            // Remove socket from user's connections
            const userSockets = this.users.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    this.users.delete(userId);
                    await this.updateUserStatus(userId, 'offline');
                }
            }

            // Handle active call disconnection
            await this.handleCallDisconnection(userId, socket);

            // Cleanup pending calls
            this.cleanupPendingCallsBySocket(socket.id);

            logger.debug(`Disconnect processing completed for user ${userId}`);

        } catch (error) {
            logger.error('Disconnect handler error:', error);
        }
    }

    // Call Management
    async handleCall(socket, { callerId, receiverId, callType = 'AUDIO' }) {
        let callKey;
        try {
            // Validation
            if (!callerId || !receiverId) {
                throw new Error('Caller and receiver IDs are required');
            }

            if (callerId === receiverId) {
                throw new Error('Cannot call yourself');
            }

            callKey = this.generateCallKey(callerId, receiverId);

            logger.info(`[CALL_INITIATE] ${callerId} -> ${receiverId} (${callType})`, {
                socketId: socket.id,
                callKey
            });

            // Check user availability
            await this.validateUserAvailability(callerId, receiverId, socket);

            // Check for existing calls
            if (this.isUserInCall(callerId) || this.isUserInCall(receiverId)) {
                logger.warn(`[CALL_BUSY] User is in another call`, { callerId, receiverId });
                socket.emit('userBusy', {
                    userId: receiverId,
                    message: 'User is in another call'
                });
                return;
            }

            // Check for call conflicts
            if (this.hasCallConflict(callKey)) {
                logger.warn(`[CALL_CONFLICT] Call conflict detected`, { callKey });
                socket.emit('callConflict', {
                    message: 'Call already in progress',
                    callKey
                });
                return;
            }

            // Create call record
            const callRecord = await this.createCallRecord({
                callerId,
                receiverId,
                callType,
                // callDirection: 'USER_TO_ASTROLOGER',
                socketId: socket.id
            });

            // Setup pending call
            this.setupPendingCall(callKey, {
                callerId,
                receiverId,
                callType,
                callRecordId: callRecord._id,
                socketId: socket.id,
                timestamp: Date.now(),
                status: 'INITIATED'
            });

            // Set active call state
            this.setActiveCallState(callerId, receiverId, callKey);

            // Update call status to RINGING
            await callRecord.markRinging();

            // Notify receiver
            await this.notifyReceiver(callerId, receiverId, callType, callRecord);

            // Set ring timeout
            this.setRingTimeout(callKey, callerId, receiverId, callRecord._id);

            logger.info(`[CALL_SETUP_COMPLETE] ${callKey}`, {
                callRecordId: callRecord._id
            });

        } catch (error) {
            logger.error(`Call initiation error:`, error);
            this.cleanupCallResources(callKey, callerId, receiverId, socket);
            socket.emit('callError', {
                message: 'Failed to initiate call',
                details: error.message
            });
        }
    }

    async handleAcceptCall(socket, { receiverId, callerId, callRecordId }) {
        try {
            const callKey = this.generateCallKey(callerId, receiverId);

            logger.info(`[CALL_ACCEPT] ${receiverId} accepting call from ${callerId}`, {
                callRecordId,
                socketId: socket.id
            });

            // Fetch call record
            const callRecord = await Call.findById(callRecordId);
            if (!callRecord) {
                throw new Error('Call record not found');
            }

            // Clear ring timeout
            this.clearCallTimeout(callKey);

            // Update call record to connected
            callRecord.status = 'CONNECTED';
            callRecord.connectTime = new Date();
            // set receiver socket id
            if (!callRecord.socketIds) callRecord.socketIds = {};
            callRecord.socketIds.receiver = socket.id;
            await callRecord.save();

            // Start call timing
            this.callTimings.set(callKey, {
                startTime: new Date(),
                callRecordId: callRecord._id,
                callerId,
                receiverId,
                connectTime: callRecord.connectTime
            });

            // Optionally fetch caller/receiver user meta for nicer payload
            const [callerUser, receiverUser] = await Promise.all([
                User.findById(callerId).select('name fullName profilePicture'),
                User.findById(receiverId).select('name fullName profilePicture')
            ]);

            // Prepare payloads
            const payloadForCaller = {
                callerId,               // original caller id
                receiverId,             // who accepted
                receiverSocketId: socket.id,
                receiverName: receiverUser?.fullName || undefined,
                receiverPicture: receiverUser?.profilePicture || undefined,
                callRecordId: callRecord._id,
                callType: callRecord.callType,
                timestamp: new Date()
            };

            const payloadForReceiver = {
                callerId,
                callerSocketId: callRecord.socketIds?.caller || null,
                callerName: callerUser?.fullName || undefined,
                callerPicture: callerUser?.profilePicture || undefined,
                callRecordId: callRecord._id,
                callType: callRecord.callType,
                timestamp: new Date()
            };

            // Emit to caller
            const sentToCaller = this.emitToUser(callerId, 'callAccepted', payloadForCaller);
            if (!sentToCaller) {
                logger.warn(`[EMIT_WARN] callAccepted NOT delivered to caller ${callerId}. They may not be connected.`);
            } else {
                logger.info(`[EMIT] callAccepted delivered to caller ${callerId}`, { callRecordId: callRecord._id });
            }

            // Emit to receiver (so receiver UI can also transition if it listens for the same event)
            const sentToReceiver = this.emitToUser(receiverId, 'callAccepted', payloadForReceiver);
            if (!sentToReceiver) {
                logger.warn(`[EMIT_WARN] callAccepted NOT delivered to receiver ${receiverId}.`);
            } else {
                logger.info(`[EMIT] callAccepted delivered to receiver ${receiverId}`, { callRecordId: callRecord._id });
            }

            // Stop caller tune (existing behavior)
            this.emitToUser(callerId, 'stopCallerTune', { callerId });

            // Remove pending call and keep activeCalls as-is (connected)
            this.pendingCalls.delete(callKey);

            logger.info(`[CALL_CONNECTED] ${callKey}`, {
                callRecordId: callRecord._id,
                connectTime: callRecord.connectTime
            });

        } catch (error) {
            logger.error(`Call accept error:`, error);
            socket.emit('callError', {
                message: 'Failed to accept call',
                details: error.message
            });
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

            // Notify both parties
            this.emitToUser(receiverId, 'callEnded', {
                callerId,
                receiverId,
                duration: callDuration,
                totalDuration: duration,
                reason,
                timestamp: endTime,
                callRecordId: callRecord._id
            });

            // Send push notifications
            if (callRecord.userId && callRecord.astrologerId) {
                const callerData = callRecord.userId._id.toString() === callerId ?
                    callRecord.userId : callRecord.astrologerId;
                const receiverData = callRecord.userId._id.toString() === receiverId ?
                    callRecord.userId : callRecord.astrologerId;

                await NotificationService.sendCallEndedNotification(
                    receiverId,
                    callerData,
                    callRecord._id,
                    callDuration
                );
            }

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

    async handleRejectCall(socket, { receiverId, callerId, callRecordId, reason = 'user_busy' }) {
        try {
            const callKey = this.generateCallKey(callerId, receiverId);

            logger.info(`[CALL_REJECT] ${receiverId} rejecting call from ${callerId}`, {
                callRecordId,
                reason,
                socketId: socket.id
            });

            // Update call record
            const callRecord = await Call.findByIdAndUpdate(
                callRecordId,
                {
                    status: 'REJECTED',
                    endTime: new Date(),
                    feedback: reason
                },
                { new: true }
            ).populate('userId', 'name fullName profilePicture');

            // Notify caller
            this.emitToUser(callerId, 'callRejected', {
                receiverId,
                callRecordId: callRecord._id,
                reason,
                timestamp: new Date()
            });

            // Stop caller tune
            this.emitToUser(callerId, 'stopCallerTune', { callerId });

            // Send push notification
            if (callRecord.userId) {
                await NotificationService.sendCallMissedNotification(
                    callerId,
                    callRecord.userId,
                    callRecord._id
                );
            }

            // Cleanup resources
            this.cleanupCallResources(callKey, callerId, receiverId, socket);

            logger.info(`[CALL_REJECTED] ${callKey}`, {
                callRecordId: callRecord._id,
                reason
            });

        } catch (error) {
            logger.error(`Call reject error:`, error);
            socket.emit('callError', {
                message: 'Failed to reject call',
                details: error.message
            });
        }
    }

    async handleCancelCall(socket, { callerId, receiverId, callRecordId }) {
        const callKey = this.generateCallKey(callerId, receiverId);

        try {
            // ✅ If callRecordId not provided, get it from pending calls
            if (!callRecordId) {
                callRecordId = this.getCallRecordId(callKey);
            }

            if (!callRecordId) {
                throw new Error('Call record ID not found');
            }

            logger.info(`[CALL_CANCEL] ${callerId} cancelling call to ${receiverId}`, {
                callRecordId,
                socketId: socket.id
            });

            // Update call record
            const callRecord = await Call.findByIdAndUpdate(
                callRecordId,
                {
                    status: 'CANCELLED',
                    endTime: new Date()
                },
                { new: true }
            );

            // Notify receiver
            this.emitToUser(receiverId, 'callCancelled', {
                callerId,
                callRecordId: callRecord._id,
                timestamp: new Date()
            });

            // Stop incoming call notification for receiver
            this.emitToUser(receiverId, 'stopIncomingCall', {
                callerId,
                callRecordId: callRecord._id
            });

            logger.info(`[CALL_CANCELLED] ${callKey}`, {
                callRecordId: callRecord._id
            });

        } catch (error) {
            logger.error(`[CALL_CANCEL_ERROR] ${callerId} → ${receiverId}:`, error);

            socket.emit('callError', {
                message: 'Failed to cancel call',
                details: error.message
            });
        } finally {
            // ✅ Always clean up resources even if something fails
            this.cleanupCallResources(callKey, callerId, receiverId, socket);
        }
    }


    async handleMissedCall(socket, { receiverId, callerId, callRecordId }) {
        try {
            const callKey = this.generateCallKey(callerId, receiverId);

            logger.info(`[CALL_MISSED] ${receiverId} missed call from ${callerId}`, {
                callRecordId,
                socketId: socket.id
            });

            // Update call record
            const callRecord = await Call.findByIdAndUpdate(
                callRecordId,
                {
                    status: 'MISSED',
                    endTime: new Date()
                },
                { new: true }
            ).populate('userId', 'name fullName profilePicture');

            // Send push notification
            if (callRecord.userId) {
                await NotificationService.sendCallMissedNotification(
                    receiverId,
                    callRecord.userId,
                    callRecord._id
                );
            }

            // Notify caller
            this.emitToUser(callerId, 'callMissed', {
                receiverId,
                callRecordId: callRecord._id,
                timestamp: new Date()
            });

            // Cleanup resources
            this.cleanupCallResources(callKey, callerId, receiverId, socket);

            logger.info(`[CALL_MISSED] ${callKey}`, {
                callRecordId: callRecord._id
            });

        } catch (error) {
            logger.error(`Missed call handling error:`, error);
            socket.emit('callError', {
                message: 'Failed to process missed call',
                details: error.message
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  SIGNALING HELPERS (add to WebRTCService class)
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Generate a deterministic call key – used everywhere for lookup.
     */
    generateCallKey(a, b) {
        return [a, b].sort().join('_');
    }

    /**
     * Emit to a user (handles multiple sockets, offline users, returns boolean)
     */
    emitToUser(userId, event, payload) {
        const sockets = this.users.get(userId);
        if (!sockets || sockets.size === 0) {
            logger.warn(`[EMIT] User offline – ${event}`, { userId, payload });
            return false;
        }
        sockets.forEach(sid => this.io.to(sid).emit(event, payload));
        return true;
    }

    /**
     * Validate SDP payload (offer / answer)
     */
    validateSDP(type, data) {
        if (!data || typeof data.sdp !== 'string' || !data.sdp.includes('m=')) {
            throw new Error(`Invalid ${type} SDP`);
        }
    }

    /**
     * Validate ICE candidate
     */
    validateIceCandidate(candidate) {
        if (!candidate || typeof candidate.candidate !== 'string') {
            throw new Error('Invalid ICE candidate');
        }
    }

    /**
     * Standard error response
     */
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

    // ─────────────────────────────────────────────────────────────────────────────
    //  1. OFFER
    // ─────────────────────────────────────────────────────────────────────────────
    async handleOffer(socket, { offer, callerId, receiverId, callRecordId }) {
        const callKey = this.generateCallKey(callerId, receiverId);
        const logCtx = { callKey, callRecordId, callerId, receiverId, socketId: socket.id };

        try {
            // ── 1. Input validation ────────────────────────────────────────
            if (!offer?.sdp || !callerId || !receiverId || !callRecordId) {
                throw Object.assign(new Error('Missing required fields'), { code: 'BAD_REQUEST' });
            }
            this.validateSDP('offer', offer);

            // ── 2. State check (must be CONNECTING) ───────────────────────
            const active = this.activeCalls.get(callerId);
            console.log("active", active)

            if (!active || active.callKey !== callKey) {
                throw Object.assign(new Error('Call not in CONNECTING state'), { code: 'INVALID_STATE' });
            }

            // ── 3. Forward to receiver ─────────────────────────────────────
            const sent = this.emitToUser(receiverId, 'offer', {
                offer,
                callerId,
                receiverId,
                callRecordId,
                timestamp: Date.now(),
            });

            if (!sent) {
                await this.flushBufferedIce(callKey, receiverId); // ← ADD
            }

            logger.debug('[OFFER] Forwarded', logCtx);
        } catch (err) {
            this.emitSignalingError(socket, 'OFFER_ERROR', err, callRecordId);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  2. ANSWER
    // ─────────────────────────────────────────────────────────────────────────────
    async handleAnswer(socket, { answer, receiverId, callerId, callRecordId }) {
        const callKey = this.generateCallKey(callerId, receiverId);
        const logCtx = { callKey, callRecordId, callerId, receiverId, socketId: socket.id };

        try {
            // ── 1. Validation ───────────────────────────────────────────────
            if (!answer?.sdp || !callerId || !receiverId || !callRecordId) {
                throw Object.assign(new Error('Missing required fields'), { code: 'BAD_REQUEST' });
            }
            this.validateSDP('answer', answer);

            // ── 2. State check ──────────────────────────────────────────────
            const active = this.activeCalls.get(receiverId);
            console.log("active", active)
            if (!active || active.callKey !== callKey) {
                throw Object.assign(new Error('Call not in CONNECTING state'), { code: 'INVALID_STATE' });
            }

            // ── 3. Forward to caller ───────────────────────────────────────
            const sent = this.emitToUser(callerId, 'answer', {
                answer,
                callerId,
                receiverId,
                callRecordId,
                timestamp: Date.now(),
            });

            if (!sent) {
                await this.flushBufferedIce(callKey, callerId); // ← ADD
            }

            logger.debug('[ANSWER] Forwarded', logCtx);
        } catch (err) {
            this.emitSignalingError(socket, 'ANSWER_ERROR', err, callRecordId);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  3. ICE CANDIDATE
    // ─────────────────────────────────────────────────────────────────────────────
    // 🧩 Use arrow function to auto-bind `this`
    handleIceCandidate(socket, { candidate, signalingCallerId, signalingReceiverId, callRecordId }) {
    try {
        if (!candidate || !signalingCallerId || !signalingReceiverId) {
            console.warn("Invalid ICE candidate payload:", { candidate, signalingCallerId, signalingReceiverId });
            return;
        }

        const callKey = `${signalingCallerId}_${signalingReceiverId}`;

        console.log("🧊 ICE Candidate received:", {
            callKey,
            callRecordId,
            candidateType: candidate.candidate?.split(" ")[7] || "unknown",
            from: signalingCallerId,
            to: signalingReceiverId
        });

        // Forward ICE candidate to the other peer
        const targetSocket = activeUsers.get(signalingReceiverId);
        if (targetSocket) {
            targetSocket.emit("iceCandidate", {
                candidate,
                from: signalingCallerId,
                callRecordId
            });
            console.log("✅ ICE candidate sent to receiver");
        } else {
            console.warn("⚠️ Receiver not connected:", signalingReceiverId);
        }

    } catch (err) {
        console.error("❌ Error in handleIceCandidate:", err);
    }
}


// ─────────────────────────────────────────────────────────────────────────────
//  Helper: flush buffered ICE when remote description arrives
//  Call this from handleAnswer / handleOffer after setRemoteDescription
// ─────────────────────────────────────────────────────────────────────────────
flushBufferedIce(callKey, targetUserId) {
    const buf = this.iceBuffer.get(callKey) || [];
    if (!buf.length) return;

    buf.forEach(item => {
        this.emitToUser(targetUserId, 'iceCandidate', {
            candidate: item.candidate,
            callerId: item.callerId,
            receiverId: targetUserId,
            callRecordId: item.callRecordId,
            timestamp: Date.now(),
        });
    });

    this.iceBuffer.delete(callKey);
    logger.debug('[ICE] Flushed buffered candidates', { callKey, count: buf.length });
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

// Utility Methods
generateCallKey(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
}

    async validateUserAvailability(callerId, receiverId, socket) {
    const [caller, receiver] = await Promise.all([
        User.findById(callerId),
        User.findById(receiverId)
    ]);

    if (!caller || !receiver) {
        throw new Error('User not found');
    }

    if (receiver.userStatus === 'InActive' || receiver.isSuspended) {
        socket.emit('receiverUnavailable', {
            message: 'User is currently unavailable'
        });
        throw new Error('Receiver unavailable');
    }

    if (caller.isSuspended) {
        socket.emit('callerSuspended', {
            message: 'Your account is suspended'
        });
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
        socketIds: {
            caller: callData.socketId
        },
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

getCallRecordIdByUsers(callerId, receiverId) {
    const callKey = this.generateCallKey(callerId, receiverId);
    return this.getCallRecordId(callKey);
}
setActiveCallState(callerId, receiverId, callKey) {
    this.activeCalls.set(callerId, {
        callKey,
        callerId,
        receiverId,
        status: this.CALL_STATES.CONNECTING,
        pc: {}, // optional placeholder for later pc metadata if you keep it server-side
    });

    // Optional: create entry for receiver too (helps later lookups):
    this.activeCalls.set(receiverId, {
        callKey,
        callerId,
        receiverId,
        status: this.CALL_STATES.RINGING,
        pc: {}
    });
}

    async notifyReceiver(callerId, receiverId, callType, callRecord) {
    const caller = await User.findById(callerId).select('name fullName profilePicture');

    // Socket notification to receiver
    this.emitToUser(receiverId, 'incomingCall', {
        callerId,
        receiverId,
        callerName: caller.fullName || caller.fullName,
        callerPicture: caller.profilePicture,
        callType,
        callRecordId: callRecord._id,
        timestamp: Date.now()
    });

    // Play caller tune to caller
    this.emitToUser(callerId, 'playCallerTune', { callerId });

    // Send push notification to receiver
    await NotificationService.sendIncomingCallNotification(
        receiverId,
        caller,
        callRecord._id
    );

    logger.debug(`[RECEIVER_NOTIFIED] Receiver ${receiverId} notified about incoming call`, {
        callRecordId: callRecord._id,
        callType
    });
}

setRingTimeout(callKey, callerId, receiverId, callRecordId) {
    const timeout = setTimeout(async () => {
        logger.info(`[RING_TIMEOUT] Call ${callKey} timed out`);

        // Update call record
        await Call.findByIdAndUpdate(callRecordId, {
            status: 'MISSED',
            endTime: new Date()
        });

        // Notify caller
        this.emitToUser(callerId, 'callTimeout', {
            receiverId,
            callRecordId,
            message: 'Call timed out'
        });

        // Notify receiver to stop ringing
        this.emitToUser(receiverId, 'stopIncomingCall', {
            callerId,
            callRecordId
        });

        // Cleanup resources
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
        Array.from(this.pendingCalls.values()).some(call =>
            call.callerId === userId || call.receiverId === userId
        );
}

hasCallConflict(callKey) {
    const existingCall = this.pendingCalls.get(callKey);
    if (!existingCall) return false;

    const timeSinceCall = Date.now() - existingCall.timestamp;
    return timeSinceCall < this.CONFLICT_WINDOW;
}

findUserIdBySocket(socketId) {
    for (const [userId, socketIds] of this.users.entries()) {
        if (socketIds.has(socketId)) {
            return userId;
        }
    }
    return null;
}

emitToUser(userId, event, data) {
    const userSockets = this.users.get(userId);
    if (userSockets && userSockets.size > 0) {
        userSockets.forEach(socketId => {
            this.io.to(socketId).emit(event, data);
        });
        return true;
    }
    return false;
}

broadcastUserStatus(userId, status, userData = null) {
    this.io.emit('userStatusChanged', {
        userId,
        status,
        isOnline: status === 'Online',
        lastSeen: status === 'offline' ? new Date() : undefined,
        userData
    });
}

cleanupCallResources(callKey, callerId, receiverId, socket = null) {
    // Clear timeouts
    this.clearCallTimeout(callKey);

    // Remove from collections
    this.pendingCalls.delete(callKey);
    this.activeCalls.delete(callerId);
    this.activeCalls.delete(receiverId);
    this.callTimings.delete(callKey);
    this.callTimeouts.delete(callKey);

    logger.debug(`[CLEANUP] Resources cleaned for ${callKey}`, {
        callerId,
        receiverId
    });
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

    async handleCallDisconnection(userId, socket) {
    const activeCall = this.activeCalls.get(userId);
    if (!activeCall) return;

    const { otherUserId, callKey } = activeCall;

    try {
        const callTiming = this.callTimings.get(callKey);
        if (callTiming) {
            const endTime = new Date();
            const duration = Math.round((endTime - callTiming.startTime) / 1000);
            let callDuration = 0;

            if (callTiming.connectTime) {
                callDuration = Math.round((endTime - callTiming.connectTime) / 1000);
            }

            await Call.findByIdAndUpdate(callTiming.callRecordId, {
                endTime,
                duration,
                status: 'DISCONNECTED',
                disconnectedBy: userId
            });

            // Notify other user
            this.emitToUser(otherUserId, 'callEnded', {
                reason: 'disconnected',
                disconnectedBy: userId,
                duration: callDuration,
                totalDuration: duration,
                callRecordId: callTiming.callRecordId
            });

            logger.info(`[CALL_DISCONNECTED] User ${userId} disconnected from call`, {
                callKey,
                callDuration,
                totalDuration: duration
            });
        }

        this.cleanupCallResources(callKey, userId, otherUserId);

    } catch (error) {
        logger.error(`Call disconnection handling error:`, error);
    }
}

    async updateUserStatus(userId, status) {
    try {
        const updateData = {
            status,
            isOnline: status === 'Online'
        };

        if (status === 'offline') {
            updateData.lastSeen = new Date();
        }

        const user = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true }
        ).select('name fullName profilePicture status isOnline lastSeen');

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

    if (packetLoss > 10 || jitter > 50 || latency > 300) {
        return 'POOR';
    } else if (packetLoss > 5 || jitter > 20 || latency > 150) {
        return 'FAIR';
    } else if (packetLoss > 2 || jitter > 10 || latency > 100) {
        return 'GOOD';
    } else {
        return 'EXCELLENT';
    }
}

findCallBySocket(socketId) {
    // This would need additional tracking to map sockets to active calls
    // For now, return null - implement based on your specific needs
    return null;
}

    // Additional handlers
    async handleGetOnlineStatus(socket, { userId }) {
    try {
        const user = await User.findById(userId).select('status isOnline lastSeen');
        if (user) {
            socket.emit('onlineStatus', {
                userId,
                status: user.status,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen
            });
        }
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
        socket.emit('error', {
            type: 'STATUS_UPDATE_ERROR',
            message: error.message
        });
    }
}

// Get service statistics (for monitoring)
getServiceStats() {
    return {
        connectedUsers: this.users.size,
        activeCalls: this.activeCalls.size,
        pendingCalls: this.pendingCalls.size,
        callTimings: this.callTimings.size,
        userQueue: Array.from(this.users.entries()).map(([userId, sockets]) => ({
            userId,
            socketCount: sockets.size
        }))
    };
}
}

export const setupWebRTC = (io) => {
    return new WebRTCService(io);
};

