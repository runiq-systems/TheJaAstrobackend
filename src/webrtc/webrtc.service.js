import { User } from '../models/user.js';
import { NotificationService } from './notification.service.js';
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

        this.CALL_TIMEOUT = 45000; // 45 seconds
        this.RING_TIMEOUT = 30000; // 30 seconds
        this.CONFLICT_WINDOW = 5000; // 5 seconds

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

            // Get call record only
            const callRecord = await Call.findById(callRecordId);
            if (!callRecord) {
                throw new Error('Call record not found');
            }

            // Clear ring timeout
            this.clearCallTimeout(callKey);

            // Update call record
            callRecord.status = 'CONNECTED';
            callRecord.connectTime = new Date();
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

            // ✅ SIMPLIFIED: Notify caller without user details
            this.emitToUser(callerId, 'callerAccepted', {
                receiverId,
                receiverSocketId: socket.id,
                callRecordId: callRecord._id,
                callType: callRecord.callType,
                timestamp: new Date()
            });

            // ✅ SIMPLIFIED: Notify receiver without user details
            this.emitToUser(receiverId, 'callAccepted', {
                callerId,
                callerSocketId: socket.id,
                callRecordId: callRecord._id,
                callType: callRecord.callType,
                timestamp: new Date()
            });

            // Stop caller tune
            this.emitToUser(callerId, 'stopCallerTune', { callerId });

            // Cleanup pending call
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
        try {
            const callKey = this.generateCallKey(callerId, receiverId);

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

            // Cleanup resources
            this.cleanupCallResources(callKey, callerId, receiverId, socket);

            logger.info(`[CALL_CANCELLED] ${callKey}`, {
                callRecordId: callRecord._id
            });

        } catch (error) {
            logger.error(`Call cancel error:`, error);
            socket.emit('callError', {
                message: 'Failed to cancel call',
                details: error.message
            });
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

    // WebRTC Signaling
    handleOffer(socket, { offer, callerId, receiverId, callRecordId }) {
        try {
            logger.debug(`[OFFER] ${callerId} -> ${receiverId}`, {
                callRecordId,
                socketId: socket.id
            });

            this.emitToUser(receiverId, 'offer', {
                offer,
                callerId,
                callRecordId,
                timestamp: Date.now()
            });

        } catch (error) {
            logger.error(`Offer handling error:`, error);
            socket.emit('error', {
                type: 'OFFER_ERROR',
                message: error.message
            });
        }
    }

    handleAnswer(socket, { answer, receiverId, callerId, callRecordId }) {
        try {
            logger.debug(`[ANSWER] ${receiverId} -> ${callerId}`, {
                callRecordId,
                socketId: socket.id
            });

            this.emitToUser(callerId, 'answer', {
                answer,
                receiverId,
                callRecordId,
                timestamp: Date.now()
            });

        } catch (error) {
            logger.error(`Answer handling error:`, error);
            socket.emit('error', {
                type: 'ANSWER_ERROR',
                message: error.message
            });
        }
    }

    handleIceCandidate(socket, { candidate, callerId, receiverId, callRecordId }) {
        try {
            logger.debug(`[ICE_CANDIDATE] ${callerId} -> ${receiverId}`, {
                callRecordId,
                socketId: socket.id,
                candidateType: candidate?.type
            });

            this.emitToUser(receiverId, 'iceCandidate', {
                candidate,
                callerId,
                callRecordId,
                timestamp: Date.now()
            });

        } catch (error) {
            logger.error(`ICE candidate error:`, error);
            socket.emit('error', {
                type: 'ICE_CANDIDATE_ERROR',
                message: error.message
            });
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

    setActiveCallState(callerId, receiverId, callKey) {
        this.activeCalls.set(callerId, {
            otherUserId: receiverId,
            callKey,
            role: 'caller'
        });
        this.activeCalls.set(receiverId, {
            otherUserId: callerId,
            callKey,
            role: 'receiver'
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