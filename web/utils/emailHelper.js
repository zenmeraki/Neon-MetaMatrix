import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.zoho.in", // or smtp.zoho.com if you're not in India
  port: 465,
  secure: true, // true for port 465
  auth: {
    user: process.env.EMAIL_USER, // your Zoho email
    pass: process.env.EMAIL_PASS, // app password or real password
  },
});

export const sendEmail = async (to, subject, content, isHtml = false) => {
  const mailOptions = {
    from: '"Metamatrix Team" <cs@zenmeraki.com>',
    to,
    subject,
    ...(isHtml ? { html: content } : { text: content }),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
  } catch (error) {
    throw new Error(`Email send failed: ${error.message}`);
  }
};
