import { Notification } from "../models/notifications.js";


// ___________________________
// Admin Controler
// ___________________________

export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userRole = req.user.role;
    
    // Find notifications that are:
    // 1. Active
    // 2. Not expired
    // 3. Either for all users OR for user's role OR specifically for this user
    const notifications = await Notification.find({
      isActive: true,
      expiresAt: { $gt: new Date() },
      $or: [
        { isForAllUsers: true },
        { targetRoles: userRole },
        { targetUsers: userId }
      ]
    })
    .populate('createdBy', 'fullName email')
    .sort({ sentAt: -1 })
    .limit(50); // Limit to 50 recent notifications

    // Check which ones are read by this user
    const notificationsWithReadStatus = notifications.map(notification => {
      const isRead = notification.readBy.some(
        read => read.user.toString() === userId.toString()
      );
      
      return {
        id: notification._id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        date: notification.sentAt.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }),
        time: notification.sentAt.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }).toUpperCase(),
        read: isRead,
        createdAt: notification.sentAt
      };
    });

    res.status(200).json({
      success: true,
      count: notificationsWithReadStatus.length,
      data: notificationsWithReadStatus
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications'
    });
  }
};

// Get unread count
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    
    const notifications = await Notification.find({
      isActive: true,
      expiresAt: { $gt: new Date() },
      $or: [
        { isForAllUsers: true },
        { targetRoles: userRole },
        { targetUsers: userId }
      ]
    });

    const unreadCount = notifications.filter(notification => {
      return !notification.readBy.some(
        read => read.user.toString() === userId.toString()
      );
    }).length;

    res.status(200).json({
      success: true,
      count: unreadCount
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching unread count'
    });
  }
};

// Mark notification as read
export const markAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const notificationId = req.params.id;

    const notification = await Notification.findById(notificationId);
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Check if already read
    const alreadyRead = notification.readBy.some(
      read => read.user.toString() === userId.toString()
    );

    if (!alreadyRead) {
      notification.readBy.push({
        user: userId,
        readAt: new Date()
      });
      await notification.save();
    }

    res.status(200).json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking notification as read'
    });
  }
};

// Mark all notifications as read
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    
    // Find all unread notifications for this user
    const notifications = await Notification.find({
      isActive: true,
      expiresAt: { $gt: new Date() },
      $or: [
        { isForAllUsers: true },
        { targetRoles: userRole },
        { targetUsers: userId }
      ]
    });

    // Mark each as read if not already
    const updatePromises = notifications.map(async (notification) => {
      const alreadyRead = notification.readBy.some(
        read => read.user.toString() === userId.toString()
      );
      
      if (!alreadyRead) {
        notification.readBy.push({
          user: userId,
          readAt: new Date()
        });
        return notification.save();
      }
    });

    await Promise.all(updatePromises);

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Error marking all as read:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking all as read'
    });
  }
};

// ___________________________
// Admin Controler
// ___________________________

// Admin: Create notification
export const createNotification = async (req, res) => {
  try {
    const { title, message, type, targetUsers, isForAllUsers, targetRoles, metadata } = req.body;
    
    const notification = new Notification({
      title,
      message,
      type: type || 'info',
      targetUsers: targetUsers || [],
      isForAllUsers: isForAllUsers || false,
      targetRoles: targetRoles || [],
      createdBy: req.user._id,
      metadata: metadata || {}
    });

    await notification.save();

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      data: notification
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating notification'
    });
  }
};

// Admin: Get all notifications (for admin panel)
export const getAllNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const notifications = await Notification.find()
      .populate('createdBy', 'fullName email')
      .populate('targetUsers', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Notification.countDocuments();

    res.status(200).json({
      success: true,
      count: notifications.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: notifications
    });
  } catch (error) {
    console.error('Error fetching all notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications'
    });
  }
};

// Admin: Update notification
export const updateNotification = async (req, res) => {
  try {
    const notificationId = req.params.id;
    const updates = req.body;

    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      updates,
      { new: true, runValidators: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification updated successfully',
      data: notification
    });
  } catch (error) {
    console.error('Error updating notification:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notification'
    });
  }
};

// Admin: Delete notification
export const deleteNotification = async (req, res) => {
  try {
    const notificationId = req.params.id;

    const notification = await Notification.findById(notificationId);
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Soft delete by setting isActive to false
    notification.isActive = false;
    await notification.save();

    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting notification'
    });
  }
};