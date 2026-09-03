import nodemailer from 'nodemailer';

async function setupEthereal() {
  console.log('Creating Ethereal test account...');

  // Create a test account with Ethereal
  const testAccount = await nodemailer.createTestAccount();

  console.log('Ethereal test account created successfully!');
  console.log('====================================');
  console.log('SMTP Credentials for Ethereal:');
  console.log(`  Host: ${testAccount.smtp.host}`);
  console.log(`  Port: ${testAccount.smtp.port}`);
  console.log(`  User: ${testAccount.user}`);
  console.log(`  Pass: ${testAccount.pass}`);
  console.log('====================================');

  // Create a transporter using the test account
  const transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure, // true for 465, false for other ports
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  // Send a test email
  const info = await transporter.sendMail({
    from: '"Email Scheduler Test" <test@ethereal.email>', // sender address
    to: 'test@example.com', // list of receivers
    subject: 'Hello from Ethereal ✔', // Subject line
    text: 'This is a test email sent from the email scheduler backend using Ethereal.', // plain text body
    html: '<b>This is a test email sent from the email scheduler backend using Ethereal.</b>', // html body
  });

  console.log('Test email sent successfully!');
  console.log('Message ID:', info.messageId);
  // Preview URL: when using an ethereal account, this URL shows the email in a web interface
  console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
}

// Run the function and handle errors
setupEthereal().catch(console.error);