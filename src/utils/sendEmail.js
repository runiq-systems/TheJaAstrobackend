import nodemailer from 'nodemailer';
import logger from './logger.js';
import { MAIL_PASS, MAIL_USER } from '../config/constants.js';

const sendEmail = async (email, subject, message) => {
    try {
        logger.info('Attempting to send email...');
        logger.info(`Recipient: ${email}, Subject: ${subject}`);

        // Create transporter with debug and logger options
        let transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: MAIL_USER,
                pass: MAIL_PASS
            },
            debug: true, // Enable debug output
            logger: true // Enable logging
        });

        logger.info('Transporter created, verifying connection...');

        await transporter.verify((error, success) => {
            if (error) {
                logger.error('Transporter verification failed:', error);
            } else {
                logger.info('Server is ready to take our messages');
            }
        });

        let mailOptions = {
            from: process.env.MAIL_USER,
            to: email,
            subject: subject,
            text: message,
        };

        logger.info('Sending email with options:', mailOptions);

        // Send the email
        const information = await transporter.sendMail(mailOptions);
        logger.info('Email sent successfully:', information.messageId);
        return information;
    } catch (error) {
        logger.error('Error sending email:');
        logger.error('Full error object:', error);

        if (error.responseCode) {
            logger.error('SMTP response code:', error.responseCode);
        }
        if (error.response) {
            logger.error('SMTP response:', error.response);
        }

        throw new Error(`Failed to send email: ${error.message}`);
    }
};

export default sendEmail;