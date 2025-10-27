import dotenv from 'dotenv';
dotenv.config({ path: './config/config.env' });

import nodemailer from 'nodemailer';

console.log('SMTP_HOST:', process.env.SMTP_HOST);
console.log('SMTP_PORT:', process.env.SMTP_PORT);
console.log('SMTP_SECURE:', process.env.SMTP_SECURE);
console.log('EMAIL_USER set?', !!process.env.EMAIL_USER);

if (
  !process.env.SMTP_HOST ||
  !process.env.SMTP_PORT ||
  !process.env.EMAIL_USER ||
  !process.env.EMAIL_PASS
) {
  throw new Error(
    'Missing SMTP config. Set SMTP_HOST, SMTP_PORT, EMAIL_USER, EMAIL_PASS in .env'
  );
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // optional: force IPv4 by resolving to IPv4 only (if you have DNS/IPv6 issues)
  // lookup: (hostname, options, cb) => dns.lookup(hostname, { family: 4 }, cb),
});

transporter
  .verify()
  .then(() => console.log('Mailer: SMTP connection OK'))
  .catch((err) => console.error('Mailer: SMTP connection error', err));

export default async function sendEmail(options = {}) {
  const { email, subject = '', body = '', html } = options;
  if (!email) throw new Error('sendEmail: "email" is required');

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject,
    text: body,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  return info; // caller can inspect messageId etc.
}
