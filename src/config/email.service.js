import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

export const sendEmail = async ({ to, subject, html }) => {
    if (!to) return;

    try {
        await transporter.sendMail({
            from: `"Astro Platform" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
        });
    } catch (error) {
        console.error("📧 Email send failed:", error.message);
    }
};



export const approvalEmailTemplate = (name) => `
  <h2>Congratulations ${name} 🎉</h2>
  <p>Your astrologer profile has been <strong>approved</strong>.</p>
  <p>You can now go live and start accepting consultations.</p>
  <br/>
  <p>— Astro Platform Team</p>
`;



export const rejectionEmailTemplate = (name, reason) => `
  <h2>Hello ${name}</h2>
  <p>Your astrologer profile has been <strong>rejected</strong>.</p>
  <p><strong>Reason:</strong> ${reason}</p>
  <p>You may update your profile and reapply.</p>
  <br/>
  <p>— Astro Platform Team</p>
`;
