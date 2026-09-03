export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-gray-800">
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: August 2026</p>

      <p className="mb-4">
        ReachInbox Scheduler (&quot;the App&quot;) is a personal/academic project built to
        demonstrate email scheduling functionality. This page explains what
        information the App accesses and how it is used.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">1. Information We Access</h2>
      <p className="mb-4">
        When you sign in with Google, the App requests only your basic profile
        information — your name, email address, and profile picture — for the
        sole purpose of authenticating you and identifying your account within
        the App. The App does not request or access your Gmail inbox, contacts,
        or any other Google data.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">2. How We Use Your Information</h2>
      <p className="mb-4">
        Your basic profile information is used only to log you into the App
        and to associate scheduled/sent emails with your account. Emails
        composed within the App are sent through a third-party SMTP testing
        service (Ethereal) for demonstration purposes and are not delivered to
        real inboxes unless explicitly configured otherwise.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">3. Data Sharing</h2>
      <p className="mb-4">
        We do not sell, rent, or share your personal information with third
        parties. Data is stored only to support the App&apos;s core functionality
        (e.g. displaying your scheduled and sent emails).
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">4. Data Retention</h2>
      <p className="mb-4">
        As this is a demo/academic project, data may be deleted at any time
        without notice. You may request removal of your data by contacting us
        using the email below.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">5. Contact</h2>
      <p className="mb-4">
        If you have any questions about this Privacy Policy, please contact us
        at{" "}
        <a
          href="mailto:divyanshutiwari337@gmail.com"
          className="text-emerald-600 underline"
        >
          divyanshutiwari337@gmail.com
        </a>
        .
      </p>
    </div>
  );
}