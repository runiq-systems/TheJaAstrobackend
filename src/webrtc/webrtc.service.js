import { User } from '../models/user.js';
import { NotificationService } from './notification.service.js';
import logger from '../utils/logger.js';
import Call from '../models/calllogs/call.js';

// Global state
const users = new Map(); // userId -> Set(socketIds)
const activeCalls = new Map(); // userId -> callData
const pendingCalls = new Map(); // callKey -> callData
const callTimings = new Map(); // callKey -> timingData
const callTimeouts = new Map(); // callKey -> timeout
const iceBuffer = new Map(); // callKey -> [iceCandidates]

// Constants
const CALL_TIMEOUT = 45000; // 45 seconds
const RING_TIMEOUT = 30000; // 30 seconds
const CONFLICT_WINDOW = 5000; // 5 seconds

const CALL_STATES = {
    INITIATED: 'INITIATED',
    RINGING: 'RINGING',
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
    ENDED: 'ENDED',
    CANCELLED: 'CANCELLED',
    REJECTED: 'REJECTED',
    MISSED: 'MISSED',
    COMPLETED: 'COMPLETED',
    DISCONNECTED: 'DISCONNECTED'
};

// Utility Functions
const generateCallKey = (userId1, userId2) => {
    return [userId1, userId2].sort().join('_');
};

const emitToUser = (userId, event, data) => {
    const userSockets = users.get(userId);
    if (userSockets && userSockets.size > 0) {
        userSockets.forEach(socketId => {
            global.io.to(socketId).emit(event, data);
        });
        logger.debug(`[EMIT_SUCCESS] ${event} to ${userId}`, { data });
        return true;
    }
    logger.warn(`[EMIT_FAILED] User ${userId} offline for event ${event}`, { data });
    return false;
};

const validateSDP = (type, data) => {
    if (!data || typeof data.sdp !== 'string' || !data.sdp.includes('m=')) {
        throw new Error(`Invalid ${type} SDP`);
    }
};

const validateIceCandidate = (candidate) => {
    if (!candidate || typeof candidate.candidate !== 'string') {
        throw new Error('Invalid ICE candidate');
    }
};

const emitSignalingError = (socket, type, err, callRecordId) => {
    const payload = {
        type,
        code: err.code || 'UNKNOWN',
        message: err.message || 'Signaling error',
        callRecordId,
        timestamp: Date.now(),
    };
    logger.error(`[SIGNALING_ERROR] ${type}`, payload);
    socket.emit('signalingError', payload);
};

const flushBufferedIce = (callKey, targetUserId) => {
    const buf = iceBuffer.get(callKey) || [];
    if (!buf.length) return;

    buf.forEach(item => {
        emitToUser(targetUserId, 'iceCandidate', {
            candidate: item.candidate,
            callerId: item.callerId,
            receiverId: targetUserId,
            callRecordId: item.callRecordId,
            timestamp: Date.now(),
        });
    });

    iceBuffer.delete(callKey);
    logger.debug('[ICE_FLUSHED] Buffered candidates sent', { callKey, count: buf.length });
};

const clearCallTimeout = (callKey) => {
    const timeout = callTimeouts.get(callKey);
    if (timeout) {
        clearTimeout(timeout);
        callTimeouts.delete(callKey);
    }
};

const cleanupCallResources = (callKey, callerId, receiverId, socket = null) => {
    clearCallTimeout(callKey);
    pendingCalls.delete(callKey);
    activeCalls.delete(callerId);
    activeCalls.delete(receiverId);
    callTimings.delete(callKey);
    callTimeouts.delete(callKey);
    iceBuffer.delete(callKey);

    logger.debug('[CLEANUP] Call resources cleaned', { callKey, callerId, receiverId });
};

const getCallRecordId = (callKey) => {
    const pendingCall = pendingCalls.get(callKey);
    return pendingCall ? pendingCall.callRecordId : null;
};

const isUserInCall = (userId) => {
    return activeCalls.has(userId) ||
        Array.from(pendingCalls.values()).some(call =>
            call.callerId === userId || call.receiverId === userId
        );
};

const hasCallConflict = (callKey) => {
    const existingCall = pendingCalls.get(callKey);
    if (!existingCall) return false;
    const timeSinceCall = Date.now() - existingCall.timestamp;
    return timeSinceCall < CONFLICT_WINDOW;
};

const setRingTimeout = (callKey, callerId, receiverId, callRecordId) => {
    const timeout = setTimeout(async () => {
        logger.info('[RING_TIMEOUT] Call timed out', { callKey });

        try {
            await Call.findByIdAndUpdate(callRecordId, {
                status: 'MISSED',
                endTime: new Date()
            });

            emitToUser(callerId, 'callTimeout', {
                receiverId,
                callRecordId,
                message: 'Call timed out'
            });

            emitToUser(receiverId, 'stopIncomingCall', {
                callerId,
                callRecordId
            });

            cleanupCallResources(callKey, callerId, receiverId);
        } catch (error) {
            logger.error('[RING_TIMEOUT_ERROR]', error);
        }
    }, RING_TIMEOUT);

    callTimeouts.set(callKey, timeout);
};

const validateUserAvailability = async (callerId, receiverId, socket) => {
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
};

const createCallRecord = async (callData) => {
    const callRecord = new Call({
        userId: callData.callerId,
        astrologerId: callData.receiverId,
        callType: callData.callType,
        callDirection: 'USER_TO_ASTROLOGER',
        status: 'INITIATED',
        socketIds: {
            caller: callData.socketId
        },
        videoEnabled: callData.callType === 'VIDEO',
        audioEnabled: true
    });

    return await callRecord.save();
};

const notifyReceiver = async (callerId, receiverId, callType, callRecord) => {
    const caller = await User.findById(callerId).select('name fullName profilePicture');

    // Socket notification to receiver
    emitToUser(receiverId, 'incomingCall', {
        callerId,
        receiverId,
        callerName: caller.fullName || caller.name,
        callerPicture: caller.profilePicture,
        callType,
        callRecordId: callRecord._id,
        timestamp: Date.now()
    });

    // Play caller tune to caller
    emitToUser(callerId, 'playCallerTune', { callerId });

    // Send push notification to receiver
    await NotificationService.sendIncomingCallNotification(
        receiverId,
        caller,
        callRecord._id
    );

    logger.debug('[RECEIVER_NOTIFIED]', {
        receiverId,
        callRecordId: callRecord._id,
        callType
    });
};

const broadcastUserStatus = (userId, status, userData = null) => {
    global.io.emit('userStatusChanged', {
        userId,
        status,
        isOnline: status === 'Online',
        lastSeen: status === 'offline' ? new Date() : undefined,
        userData
    });
};

const updateUserStatus = async (userId, status) => {
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
            broadcastUserStatus(userId, user.status, user);
            logger.debug('[STATUS_UPDATED]', { userId, status });
        }
    } catch (error) {
        logger.error('[STATUS_UPDATE_ERROR]', { userId, error: error.message });
    }
};

const handleCallDisconnection = async (userId, socket) => {
    const activeCall = activeCalls.get(userId);
    if (!activeCall) return;

    const { otherUserId, callKey } = activeCall;

    try {
        const callTiming = callTimings.get(callKey);
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

            emitToUser(otherUserId, 'callEnded', {
                reason: 'disconnected',
                disconnectedBy: userId,
                duration: callDuration,
                totalDuration: duration,
                callRecordId: callTiming.callRecordId
            });

            logger.info('[CALL_DISCONNECTED]', {
                userId,
                callKey,
                callDuration,
                totalDuration: duration
            });
        }

        cleanupCallResources(callKey, userId, otherUserId);

    } catch (error) {
        logger.error('[CALL_DISCONNECTION_ERROR]', error);
    }
};

const cleanupPendingCallsBySocket = (socketId) => {
    for (const [callKey, callData] of pendingCalls.entries()) {
        if (callData.socketId === socketId) {
            pendingCalls.delete(callKey);
            clearCallTimeout(callKey);
            logger.debug('[CLEANUP_PENDING]', { callKey, socketId });
        }
    }
};

// Socket Event Handlers
export const setupWebRTC = (io) => {
    global.io = io;

    io.on('connection', (socket) => {
        logger.http('[USER_CONNECTED]', {
            socketId: socket.id,
            ip: socket.handshake.address,
            userAgent: socket.handshake.headers['user-agent']
        });

        // User Management
        socket.on('join', async ({ userId }) => {
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
                if (!users.has(userId)) {
                    users.set(userId, new Set());
                }
                users.get(userId).add(socket.id);

                // Store userId in socket for easy access
                socket.userId = userId;

                // Update user status
                await updateUserStatus(userId, 'Online');

                logger.info('[JOIN_SUCCESS]', {
                    userId,
                    socketId: socket.id,
                    totalSockets: users.get(userId).size,
                    username: user.fullName || user.name
                });

                socket.emit('joinSuccess', {
                    userId,
                    socketId: socket.id,
                    userStatus: user.status,
                    isOnline: user.isOnline
                });

                // Notify others about user coming online
                broadcastUserStatus(userId, 'Online', user);

            } catch (error) {
                logger.error('[JOIN_ERROR]', { userId: socket.userId, error: error.message });
                socket.emit('error', {
                    type: 'JOIN_ERROR',
                    message: error.message
                });
            }
        });

        socket.on('disconnect', async () => {
            try {
                const userId = socket.userId;
                if (!userId) return;

                logger.info('[USER_DISCONNECTED]', { userId, socketId: socket.id });

                // Remove socket from user's connections
                const userSockets = users.get(userId);
                if (userSockets) {
                    userSockets.delete(socket.id);
                    if (userSockets.size === 0) {
                        users.delete(userId);
                        await updateUserStatus(userId, 'offline');
                    }
                }

                // Handle active call disconnection
                await handleCallDisconnection(userId, socket);

                // Cleanup pending calls
                cleanupPendingCallsBySocket(socket.id);

                logger.debug('[DISCONNECT_COMPLETE]', { userId });

            } catch (error) {
                logger.error('[DISCONNECT_ERROR]', error);
            }
        });

        socket.on('getOnlineStatus', async ({ userId }) => {
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
                logger.error('[GET_STATUS_ERROR]', error);
            }
        });

        // Call Lifecycle - FIXED FOR YOUR FRONTEND
        socket.on('call', async ({ callerId, receiverId, callType = 'AUDIO' }) => {
            let callKey;
            try {
                if (!callerId || !receiverId) {
                    throw new Error('Caller and receiver IDs are required');
                }

                if (callerId === receiverId) {
                    throw new Error('Cannot call yourself');
                }

                callKey = generateCallKey(callerId, receiverId);

                logger.info('[CALL_INITIATE]', {
                    callerId,
                    receiverId,
                    callType,
                    socketId: socket.id,
                    callKey
                });

                // Check user availability
                await validateUserAvailability(callerId, receiverId, socket);

                // Check for existing calls
                if (isUserInCall(callerId) || isUserInCall(receiverId)) {
                    logger.warn('[CALL_BUSY]', { callerId, receiverId });
                    socket.emit('userBusy', {
                        userId: receiverId,
                        message: 'User is in another call'
                    });
                    return;
                }

                // Check for call conflicts
                if (hasCallConflict(callKey)) {
                    logger.warn('[CALL_CONFLICT]', { callKey });
                    socket.emit('callConflict', {
                        message: 'Call already in progress',
                        callKey
                    });
                    return;
                }

                // Create call record
                const callRecord = await createCallRecord({
                    callerId,
                    receiverId,
                    callType,
                    socketId: socket.id
                });

                // Setup pending call
                pendingCalls.set(callKey, {
                    callerId,
                    receiverId,
                    callType,
                    callRecordId: callRecord._id,
                    socketId: socket.id,
                    timestamp: Date.now(),
                    status: 'INITIATED'
                });

                // Set active call state - FIXED: Set to CONNECTING immediately for signaling
                activeCalls.set(callerId, {
                    otherUserId: receiverId,
                    callKey,
                    role: 'caller',
                    status: CALL_STATES.CONNECTING,
                    socketId: socket.id
                });
                
                activeCalls.set(receiverId, {
                    otherUserId: callerId,
                    callKey,
                    role: 'receiver', 
                    status: CALL_STATES.RINGING,
                    socketId: null
                });

                // Update call status to RINGING
                await Call.findByIdAndUpdate(callRecord._id, {
                    status: 'RINGING',
                    startTime: new Date()
                });

                // Notify receiver
                await notifyReceiver(callerId, receiverId, callType, callRecord);

                // Set ring timeout
                setRingTimeout(callKey, callerId, receiverId, callRecord._id);

                // Immediately send callAccepted to caller to start WebRTC negotiation
                socket.emit('callAccepted', {
                    callRecordId: callRecord._id,
                    receiverId,
                    callerId
                });

                logger.info('[CALL_SETUP_COMPLETE]', {
                    callKey,
                    callRecordId: callRecord._id
                });

            } catch (error) {
                logger.error('[CALL_INITIATE_ERROR]', error);
                if (callKey) {
                    cleanupCallResources(callKey, callerId, receiverId, socket);
                }
                socket.emit('callError', {
                    message: 'Failed to initiate call',
                    details: error.message
                });
            }
        });

        socket.on('acceptCall', async ({ receiverId, callerId, callRecordId }) => {
            try {
                const callKey = generateCallKey(callerId, receiverId);

                logger.info('[CALL_ACCEPT]', {
                    receiverId,
                    callerId,
                    callRecordId,
                    socketId: socket.id
                });

                // Fetch call record
                const callRecord = await Call.findById(callRecordId);
                if (!callRecord) {
                    throw new Error('Call record not found');
                }

                // Clear ring timeout
                clearCallTimeout(callKey);

                // Update receiver's socket ID in active calls
                const receiverCallData = activeCalls.get(receiverId);
                if (receiverCallData) {
                    receiverCallData.socketId = socket.id;
                    receiverCallData.status = CALL_STATES.CONNECTING;
                    activeCalls.set(receiverId, receiverCallData);
                }

                // Update caller's status to CONNECTING
                const callerCallData = activeCalls.get(callerId);
                if (callerCallData) {
                    callerCallData.status = CALL_STATES.CONNECTING;
                    activeCalls.set(callerId, callerCallData);
                }

                // Update call record
                callRecord.status = 'CONNECTING';
                callRecord.connectTime = new Date();
                if (!callRecord.socketIds) callRecord.socketIds = {};
                callRecord.socketIds.receiver = socket.id;
                await callRecord.save();

                // Start call timing
                callTimings.set(callKey, {
                    startTime: new Date(),
                    callRecordId: callRecord._id,
                    callerId,
                    receiverId,
                    connectTime: callRecord.connectTime
                });

                // Fetch user details
                const [callerUser, receiverUser] = await Promise.all([
                    User.findById(callerId).select('name fullName profilePicture'),
                    User.findById(receiverId).select('name fullName profilePicture')
                ]);

                // Send callAccepted to both parties
                emitToUser(callerId, 'callAccepted', {
                    callRecordId: callRecord._id,
                    receiverId,
                    callerId,
                    receiverSocketId: socket.id
                });

                emitToUser(receiverId, 'callAccepted', {
                    callRecordId: callRecord._id, 
                    receiverId,
                    callerId,
                    callerSocketId: callRecord.socketIds?.caller
                });

                // Stop caller tune
                emitToUser(callerId, 'stopCallerTune', { callerId });

                // Remove from pending calls (now active)
                pendingCalls.delete(callKey);

                logger.info('[CALL_ACCEPTED]', {
                    callKey,
                    callRecordId: callRecord._id,
                    connectTime: callRecord.connectTime
                });

            } catch (error) {
                logger.error('[CALL_ACCEPT_ERROR]', error);
                socket.emit('callError', {
                    message: 'Failed to accept call',
                    details: error.message
                });
            }
        });

        // WebRTC Signaling - FIXED FOR YOUR FRONTEND
        socket.on('offer', async ({ offer, callerId, receiverId, callRecordId }) => {
            const callKey = generateCallKey(callerId, receiverId);
            
            try {
                logger.debug('[OFFER_RECEIVED]', { 
                    callKey, 
                    callRecordId, 
                    from: callerId, 
                    to: receiverId,
                    socketId: socket.id 
                });

                if (!offer?.sdp || !callerId || !receiverId || !callRecordId) {
                    throw new Error('Missing required fields for offer');
                }

                validateSDP('offer', offer);

                // Forward offer to receiver
                const sent = emitToUser(receiverId, 'offer', {
                    offer,
                    callerId,
                    receiverId,
                    callRecordId,
                    timestamp: Date.now(),
                });

                if (!sent) {
                    logger.warn('[OFFER_DELIVERY_FAILED] Receiver offline', { receiverId });
                    // Buffer for when receiver comes online
                    const buf = iceBuffer.get(callKey) || [];
                    buf.push({ type: 'offer', data: offer, callerId, callRecordId });
                    iceBuffer.set(callKey, buf);
                } else {
                    logger.debug('[OFFER_FORWARDED]', { callKey, receiverId });
                }

            } catch (err) {
                logger.error('[OFFER_ERROR]', { 
                    error: err.message, 
                    callKey, 
                    callRecordId 
                });
                emitSignalingError(socket, 'OFFER_ERROR', err, callRecordId);
            }
        });

        socket.on('answer', async ({ answer, receiverId, callerId, callRecordId }) => {
            const callKey = generateCallKey(callerId, receiverId);
            
            try {
                logger.debug('[ANSWER_RECEIVED]', { 
                    callKey, 
                    callRecordId, 
                    from: receiverId, 
                    to: callerId,
                    socketId: socket.id 
                });

                if (!answer?.sdp || !callerId || !receiverId || !callRecordId) {
                    throw new Error('Missing required fields for answer');
                }

                validateSDP('answer', answer);

                // Update call status to CONNECTED
                await Call.findByIdAndUpdate(callRecordId, {
                    status: 'CONNECTED',
                    connectTime: new Date()
                });

                // Update active calls status
                const callerCallData = activeCalls.get(callerId);
                const receiverCallData = activeCalls.get(receiverId);
                if (callerCallData) callerCallData.status = CALL_STATES.CONNECTED;
                if (receiverCallData) receiverCallData.status = CALL_STATES.CONNECTED;

                // Forward answer to caller
                const sent = emitToUser(callerId, 'answer', {
                    answer,
                    callerId,
                    receiverId,
                    callRecordId,
                    timestamp: Date.now(),
                });

                if (!sent) {
                    logger.warn('[ANSWER_DELIVERY_FAILED] Caller offline', { callerId });
                } else {
                    logger.debug('[ANSWER_FORWARDED]', { callKey, callerId });
                    // Flush any buffered ICE candidates for this call
                    flushBufferedIce(callKey, callerId);
                }

            } catch (err) {
                logger.error('[ANSWER_ERROR]', { 
                    error: err.message, 
                    callKey, 
                    callRecordId 
                });
                emitSignalingError(socket, 'ANSWER_ERROR', err, callRecordId);
            }
        });

        socket.on('iceCandidate', ({ candidate, callerId, receiverId, callRecordId }) => {
            const callKey = generateCallKey(callerId, receiverId);
            
            try {
                if (!candidate || !callerId || !receiverId || !callRecordId) {
                    throw new Error('Missing required fields for ICE candidate');
                }

                validateIceCandidate(candidate);

                logger.debug('[ICE_CANDIDATE_RECEIVED]', {
                    callKey,
                    callRecordId,
                    from: socket.userId,
                    to: socket.userId === callerId ? receiverId : callerId,
                    candidate: candidate.candidate.substring(0, 50) + '...'
                });

                // Determine target user
                const targetUserId = socket.userId === callerId ? receiverId : callerId;

                // Forward ICE candidate to target user
                const sent = emitToUser(targetUserId, 'iceCandidate', {
                    candidate,
                    callerId,
                    receiverId,
                    callRecordId,
                    timestamp: Date.now(),
                });

                if (!sent) {
                    logger.debug('[ICE_BUFFERED] Target user offline', { targetUserId });
                    // Buffer ICE candidate
                    const buf = iceBuffer.get(callKey) || [];
                    buf.push({ candidate, callerId, callRecordId });
                    iceBuffer.set(callKey, buf);
                }

            } catch (err) {
                logger.error('[ICE_CANDIDATE_ERROR]', { 
                    error: err.message, 
                    callKey, 
                    callRecordId 
                });
                emitSignalingError(socket, 'ICE_CANDIDATE_ERR', err, callRecordId);
            }
        });

        socket.on('callMediaConnected', async ({ callRecordId }) => {
            try {
                logger.info('[MEDIA_CONNECTED]', { callRecordId, userId: socket.userId });
                
                // Update call record if needed
                await Call.findByIdAndUpdate(callRecordId, {
                    status: 'CONNECTED'
                });

            } catch (error) {
                logger.error('[MEDIA_CONNECTED_ERROR]', error);
            }
        });

        socket.on('endCall', async ({ callerId, receiverId, callRecordId, reason = 'normal' }) => {
            try {
                const callKey = generateCallKey(callerId, receiverId);

                logger.info('[CALL_END]', {
                    callerId,
                    receiverId,
                    callRecordId,
                    reason,
                    socketId: socket.id
                });

                // Calculate duration and update call record
                const callTiming = callTimings.get(callKey);
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

                // Notify the other party
                const otherUserId = socket.userId === callerId ? receiverId : callerId;
                emitToUser(otherUserId, 'callEnded', {
                    callerId,
                    receiverId,
                    duration: callDuration,
                    totalDuration: duration,
                    reason,
                    timestamp: endTime,
                    callRecordId: callRecord._id
                });

                // Send push notifications if needed
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
                cleanupCallResources(callKey, callerId, receiverId, socket);

                logger.info('[CALL_ENDED]', {
                    callKey,
                    callDuration,
                    totalDuration: duration,
                    callRecordId: callRecord._id,
                    reason
                });

            } catch (error) {
                logger.error('[CALL_END_ERROR]', error);
                socket.emit('callError', {
                    message: 'Failed to end call',
                    details: error.message
                });
            }
        });

        // Additional event handlers for your frontend
        socket.on('rejectCall', async ({ receiverId, callerId, callRecordId, reason = 'user_busy' }) => {
            try {
                const callKey = generateCallKey(callerId, receiverId);

                logger.info('[CALL_REJECT]', {
                    receiverId,
                    callerId,
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
                emitToUser(callerId, 'callRejected', {
                    receiverId,
                    callRecordId: callRecord._id,
                    reason,
                    timestamp: new Date()
                });

                // Stop caller tune
                emitToUser(callerId, 'stopCallerTune', { callerId });

                // Cleanup resources
                cleanupCallResources(callKey, callerId, receiverId, socket);

                logger.info('[CALL_REJECTED]', {
                    callKey,
                    callRecordId: callRecord._id,
                    reason
                });

            } catch (error) {
                logger.error('[CALL_REJECT_ERROR]', error);
                socket.emit('callError', {
                    message: 'Failed to reject call',
                    details: error.message
                });
            }
        });

        socket.on('cancelCall', async ({ callerId, receiverId, callRecordId }) => {
            const callKey = generateCallKey(callerId, receiverId);

            try {
                if (!callRecordId) {
                    callRecordId = getCallRecordId(callKey);
                }

                if (!callRecordId) {
                    throw new Error('Call record ID not found');
                }

                logger.info('[CALL_CANCEL]', {
                    callerId,
                    receiverId,
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
                emitToUser(receiverId, 'callCancelled', {
                    callerId,
                    callRecordId: callRecord._id,
                    timestamp: new Date()
                });

                // Stop incoming call notification for receiver
                emitToUser(receiverId, 'stopIncomingCall', {
                    callerId,
                    callRecordId: callRecord._id
                });

                logger.info('[CALL_CANCELLED]', {
                    callKey,
                    callRecordId: callRecord._id
                });

            } catch (error) {
                logger.error('[CALL_CANCEL_ERROR]', { callerId, receiverId, error: error.message });
                socket.emit('callError', {
                    message: 'Failed to cancel call',
                    details: error.message
                });
            } finally {
                cleanupCallResources(callKey, callerId, receiverId, socket);
            }
        });

        // User Status
        socket.on('updateStatus', async ({ status }) => {
            try {
                const userId = socket.userId;
                if (!userId) return;

                await updateUserStatus(userId, status);
                socket.emit('statusUpdated', { status });

            } catch (error) {
                logger.error('[UPDATE_STATUS_ERROR]', error);
                socket.emit('error', {
                    type: 'STATUS_UPDATE_ERROR',
                    message: error.message
                });
            }
        });
    });

    // Service statistics function
    const getServiceStats = () => {
        return {
            connectedUsers: users.size,
            activeCalls: activeCalls.size,
            pendingCalls: pendingCalls.size,
            callTimings: callTimings.size,
            userQueue: Array.from(users.entries()).map(([userId, sockets]) => ({
                userId,
                socketCount: sockets.size
            }))
        };
    };

    return {
        getServiceStats
    };
};

// Helper function for network quality calculation
const calculateNetworkQuality = (metrics) => {
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
};