import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy · FieldSlate",
  description:
    "How FieldSlate collects, uses, stores, and shares your information.",
};

const LAST_UPDATED = "May 26, 2026";

// Anchor-link helper so every section heading also serves as a `#hash` target
// for the table of contents.
function SectionHeading({
  id,
  number,
  children,
}: {
  id: string;
  number: number;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="scroll-mt-24 text-xl font-bold text-[#0C1F3F] sm:text-2xl"
    >
      {number}. {children}
    </h2>
  );
}

function InShort({ children }: { children: React.ReactNode }) {
  return (
    <p className="italic text-gray-600">
      <strong className="not-italic text-gray-700">In short:</strong> {children}
    </p>
  );
}

const tocItems: { id: string; label: string }[] = [
  { id: "infocollect", label: "1. What information do we collect?" },
  { id: "infouse", label: "2. How do we process your information?" },
  { id: "whoshare", label: "3. When and with whom do we share your personal information?" },
  { id: "cookies", label: "4. Do we use cookies and other tracking technologies?" },
  { id: "inforetain", label: "5. How long do we keep your information?" },
  { id: "infosafe", label: "6. How do we keep your information safe?" },
  { id: "infominors", label: "7. Do we collect information from minors?" },
  { id: "privacyrights", label: "8. What are your privacy rights?" },
  { id: "dnt", label: "9. Controls for Do-Not-Track features" },
  { id: "uslaws", label: "10. Do United States residents have specific privacy rights?" },
  { id: "policyupdates", label: "11. Do we make updates to this notice?" },
  { id: "contact", label: "12. How can you contact us about this notice?" },
  { id: "request", label: "13. How can you review, update, or delete the data we collect from you?" },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        {/* Header */}
        <div className="border-b border-gray-100 pb-8">
          <h1 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Last updated {LAST_UPDATED}
          </p>
        </div>

        {/* Intro */}
        <section className="mt-10 space-y-4 text-sm leading-relaxed text-gray-700">
          <p>
            This Privacy Notice for Whitney Mellon-King (<strong>&ldquo;we&rdquo;</strong>,{" "}
            <strong>&ldquo;us&rdquo;</strong>, or <strong>&ldquo;our&rdquo;</strong>) describes how
            and why we might access, collect, store, use, and/or share
            (&ldquo;<strong>process</strong>&rdquo;) your personal information when you use our
            services (&ldquo;<strong>Services</strong>&rdquo;), including when you:
          </p>
          <ul className="ml-6 list-disc space-y-1.5">
            <li>
              Visit our website at{" "}
              <a
                href="https://www.thefieldslate.com"
                className="font-medium text-[#22C55E] hover:underline"
              >
                https://www.thefieldslate.com
              </a>{" "}
              or any website of ours that links to this Privacy Notice
            </li>
            <li>
              Use FieldSlate. FieldSlate is a web-based scheduling and league
              management platform for youth sports organizations. It allows
              league administrators to create and manage divisions, teams, game
              schedules, and practice assignments. FieldSlate is a
              subscription-based SaaS product intended for use by league
              administrators, not by players or parents directly.
            </li>
            <li>
              Engage with us in other related ways, including any marketing or
              events
            </li>
          </ul>
          <p>
            <strong>Questions or concerns?</strong> Reading this Privacy Notice
            will help you understand your privacy rights and choices. We are
            responsible for making decisions about how your personal information
            is processed. If you do not agree with our policies and practices,
            please do not use our Services. If you still have any questions or
            concerns, please contact us at{" "}
            <a
              href="mailto:hello@thefieldslate.com"
              className="font-medium text-[#22C55E] hover:underline"
            >
              hello@thefieldslate.com
            </a>
            .
          </p>
        </section>

        {/* Summary */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <h2 className="text-xl font-bold text-[#0C1F3F]">
            Summary of key points
          </h2>
          <p className="italic text-gray-600">
            <strong className="not-italic text-gray-700">
              This summary provides key points from our Privacy Notice, but you
              can find out more details about any of these topics by clicking
              the link following each key point or by using our{" "}
              <a href="#toc" className="text-[#22C55E] hover:underline">
                table of contents
              </a>{" "}
              below.
            </strong>
          </p>
          <p>
            <strong>What personal information do we process?</strong> When you
            visit, use, or navigate our Services, we may process personal
            information depending on how you interact with us and the Services,
            the choices you make, and the products and features you use. Learn
            more about{" "}
            <a href="#personalinfo" className="text-[#22C55E] hover:underline">
              personal information you disclose to us
            </a>
            .
          </p>
          <p>
            <strong>Do we process any sensitive personal information?</strong>{" "}
            Some of the information may be considered &ldquo;special&rdquo; or
            &ldquo;sensitive&rdquo; in certain jurisdictions, for example your
            racial or ethnic origins, sexual orientation, and religious
            beliefs. We do not process sensitive personal information.
          </p>
          <p>
            <strong>Do we collect any information from third parties?</strong>{" "}
            We do not collect any information from third parties.
          </p>
          <p>
            <strong>How do we process your information?</strong> We process your
            information to provide, improve, and administer our Services,
            communicate with you, for security and fraud prevention, and to
            comply with law. We may also process your information for other
            purposes with your consent. We process your information only when we
            have a valid legal reason to do so. Learn more about{" "}
            <a href="#infouse" className="text-[#22C55E] hover:underline">
              how we process your information
            </a>
            .
          </p>
          <p>
            <strong>
              In what situations and with which parties do we share personal
              information?
            </strong>{" "}
            We may share information in specific situations and with specific
            third parties. Learn more about{" "}
            <a href="#whoshare" className="text-[#22C55E] hover:underline">
              when and with whom we share your personal information
            </a>
            .
          </p>
          <p>
            <strong>How do we keep your information safe?</strong> We have
            adequate organizational and technical processes and procedures in
            place to protect your personal information. However, no electronic
            transmission over the internet or information storage technology
            can be guaranteed to be 100% secure, so we cannot promise or
            guarantee that hackers, cybercriminals, or other unauthorized third
            parties will not be able to defeat our security and improperly
            collect, access, steal, or modify your information. Learn more
            about{" "}
            <a href="#infosafe" className="text-[#22C55E] hover:underline">
              how we keep your information safe
            </a>
            .
          </p>
          <p>
            <strong>What are your rights?</strong> Depending on where you are
            located geographically, the applicable privacy law may mean you
            have certain rights regarding your personal information. Learn more
            about{" "}
            <a href="#privacyrights" className="text-[#22C55E] hover:underline">
              your privacy rights
            </a>
            .
          </p>
          <p>
            <strong>How do you exercise your rights?</strong> The easiest way to
            exercise your rights is by visiting{" "}
            <a
              href="/contact"
              className="font-medium text-[#22C55E] hover:underline"
            >
              https://thefieldslate.com/contact
            </a>
            , or by contacting us. We will consider and act upon any request in
            accordance with applicable data protection laws.
          </p>
          <p>
            Want to learn more about what we do with any information we
            collect?{" "}
            <a href="#toc" className="text-[#22C55E] hover:underline">
              Review the Privacy Notice in full
            </a>
            .
          </p>
        </section>

        {/* Table of contents */}
        <section id="toc" className="mt-12 rounded-2xl border border-gray-100 bg-gray-50/60 p-6 scroll-mt-24">
          <h2 className="text-lg font-bold text-[#0C1F3F]">Table of contents</h2>
          <ol className="mt-3 space-y-1.5 text-sm">
            {tocItems.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="text-[#22C55E] hover:underline"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </section>

        {/* 1. WHAT INFORMATION DO WE COLLECT */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="infocollect" number={1}>
            What information do we collect?
          </SectionHeading>

          <h3 id="personalinfo" className="scroll-mt-24 mt-6 text-lg font-semibold text-[#0C1F3F]">
            Personal information you disclose to us
          </h3>
          <InShort>We collect personal information that you provide to us.</InShort>
          <p>
            We collect personal information that you voluntarily provide to us
            when you register on the Services, express an interest in obtaining
            information about us or our products and Services, when you
            participate in activities on the Services, or otherwise when you
            contact us.
          </p>
          <p>
            <strong>Personal information provided by you.</strong> The personal
            information that we collect depends on the context of your
            interactions with us and the Services, the choices you make, and
            the products and features you use. The personal information we
            collect may include the following:
          </p>
          <ul className="ml-6 list-disc space-y-1">
            <li>email addresses</li>
            <li>names</li>
            <li>passwords</li>
            <li>usernames</li>
          </ul>
          <p>
            <strong>Sensitive information.</strong> We do not process sensitive
            information.
          </p>
          <p>
            <strong>Payment data.</strong> We may collect data necessary to
            process your payment if you choose to make purchases, such as your
            payment instrument number, and the security code associated with
            your payment instrument. All payment data is handled and stored by{" "}
            Stripe. You may find their privacy notice link(s) here:{" "}
            <a
              href="https://stripe.com/privacy"
              className="font-medium text-[#22C55E] hover:underline"
            >
              https://stripe.com/privacy
            </a>
            .
          </p>
          <p>
            All personal information that you provide to us must be true,
            complete, and accurate, and you must notify us of any changes to
            such personal information.
          </p>

          <h3 className="mt-6 text-lg font-semibold text-[#0C1F3F]">
            Information automatically collected
          </h3>
          <InShort>
            Some information &mdash; such as your Internet Protocol (IP)
            address and/or browser and device characteristics &mdash; is
            collected automatically when you visit our Services.
          </InShort>
          <p>
            We automatically collect certain information when you visit, use,
            or navigate the Services. This information does not reveal your
            specific identity (like your name or contact information) but may
            include device and usage information, such as your IP address,
            browser and device characteristics, operating system, language
            preferences, referring URLs, device name, country, location,
            information about how and when you use our Services, and other
            technical information. This information is primarily needed to
            maintain the security and operation of our Services, and for our
            internal analytics and reporting purposes.
          </p>
          <p>
            Like many businesses, we also collect information through cookies
            and similar technologies.
          </p>
          <p>The information we collect includes:</p>
          <ul className="ml-6 list-disc space-y-2">
            <li>
              <em>Log and usage data.</em> Log and usage data is service-related,
              diagnostic, usage, and performance information our servers
              automatically collect when you access or use our Services and
              which we record in log files. Depending on how you interact with
              us, this log data may include your IP address, device
              information, browser type, and settings and information about
              your activity in the Services (such as the date/time stamps
              associated with your usage, pages and files viewed, searches, and
              other actions you take such as which features you use), device
              event information (such as system activity, error reports
              (sometimes called &ldquo;crash dumps&rdquo;), and hardware
              settings).
            </li>
            <li>
              <em>Device data.</em> We collect device data such as information
              about your computer, phone, tablet, or other device you use to
              access the Services. Depending on the device used, this device
              data may include information such as your IP address (or proxy
              server), device and application identification numbers,
              location, browser type, hardware model, Internet service provider
              and/or mobile carrier, operating system, and system configuration
              information.
            </li>
          </ul>
        </section>

        {/* 2. HOW DO WE PROCESS YOUR INFORMATION */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="infouse" number={2}>
            How do we process your information?
          </SectionHeading>
          <InShort>
            We process your information to provide, improve, and administer our
            Services, communicate with you, for security and fraud prevention,
            and to comply with law. We may also process your information for
            other purposes with your consent.
          </InShort>
          <p>
            <strong>
              We process your personal information for a variety of reasons,
              depending on how you interact with our Services, including:
            </strong>
          </p>
          <ul className="ml-6 list-disc space-y-2">
            <li>
              <strong>
                To facilitate account creation and authentication and otherwise
                manage user accounts.
              </strong>{" "}
              We may process your information so you can create and log in to
              your account, as well as keep your account in working order.
            </li>
            <li>
              <strong>
                To deliver and facilitate delivery of services to the user.
              </strong>{" "}
              We may process your information to provide you with the requested
              service.
            </li>
            <li>
              <strong>To respond to user inquiries/offer support to users.</strong>{" "}
              We may process your information to respond to your inquiries and
              solve any potential issues you might have with the requested
              service.
            </li>
            <li>
              <strong>To send administrative information to you.</strong> We may
              process your information to send you details about our products
              and services, changes to our terms and policies, and other
              similar information.
            </li>
            <li>
              <strong>To fulfill and manage your orders.</strong> We may process
              your information to fulfill and manage your orders, payments,
              returns, and exchanges made through the Services.
            </li>
            <li>
              <strong>To send you marketing and promotional communications.</strong>{" "}
              We may process the personal information you send to us for our
              marketing purposes, if this is in accordance with your marketing
              preferences. You can opt out of our marketing emails at any time.
              For more information, see{" "}
              <a
                href="#privacyrights"
                className="text-[#22C55E] hover:underline"
              >
                &ldquo;What are your privacy rights?&rdquo;
              </a>{" "}
              below.
            </li>
            <li>
              <strong>To protect our Services.</strong> We may process your
              information as part of our efforts to keep our Services safe and
              secure, including fraud monitoring and prevention.
            </li>
            <li>
              <strong>
                To evaluate and improve our Services, products, marketing, and
                your experience.
              </strong>{" "}
              We may process your information when we believe it is necessary
              to identify usage trends, determine the effectiveness of our
              promotional campaigns, and to evaluate and improve our Services,
              products, marketing, and your experience.
            </li>
            <li>
              <strong>To identify usage trends.</strong> We may process
              information about how you use our Services to better understand
              how they are being used so we can improve them.
            </li>
            <li>
              <strong>To comply with our legal obligations.</strong> We may
              process your information to comply with our legal obligations,
              respond to legal requests, and exercise, establish, or defend our
              legal rights.
            </li>
          </ul>
        </section>

        {/* 3. WHEN AND WITH WHOM DO WE SHARE */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="whoshare" number={3}>
            When and with whom do we share your personal information?
          </SectionHeading>
          <InShort>
            We may share information in specific situations described in this
            section and/or with the following third parties.
          </InShort>
          <p>
            <strong>
              Vendors, consultants, and other third-party service providers.
            </strong>{" "}
            We may share your data with third-party vendors, service providers,
            contractors, or agents (&ldquo;<strong>third parties</strong>&rdquo;)
            who perform services for us or on our behalf and require access to
            such information to do that work.
          </p>
          <p>
            The third parties we may share personal information with are as
            follows:
          </p>
          <ul className="ml-6 list-disc space-y-2">
            <li>
              <strong>Cloud computing services:</strong> Google Cloud Platform
            </li>
            <li>
              <strong>Invoice and billing:</strong> Stripe
            </li>
            <li>
              <strong>Communicate &amp; chat with users:</strong> Resend, Google
              Workspace
            </li>
            <li>
              <strong>Functionality &amp; infrastructure optimization:</strong>{" "}
              Supabase
            </li>
            <li>
              <strong>Web hosting:</strong> Vercel
            </li>
            <li>
              <strong>User account registration &amp; authentication:</strong>{" "}
              Supabase
            </li>
          </ul>
          <p>
            We also may need to share your personal information in the
            following situations:
          </p>
          <ul className="ml-6 list-disc space-y-2">
            <li>
              <strong>Business transfers.</strong> We may share or transfer your
              information in connection with, or during negotiations of, any
              merger, sale of company assets, financing, or acquisition of all
              or a portion of our business to another company.
            </li>
          </ul>
        </section>

        {/* 4. COOKIES */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="cookies" number={4}>
            Do we use cookies and other tracking technologies?
          </SectionHeading>
          <InShort>
            We may use cookies and other tracking technologies to collect and
            store your information.
          </InShort>
          <p>
            We may use cookies and similar tracking technologies (like web
            beacons and pixels) to gather information when you interact with
            our Services. Some online tracking technologies help us maintain
            the security of our Services and your account, prevent crashes,
            fix bugs, save your preferences, and assist with basic site
            functions.
          </p>
          <p>
            We also permit third parties and service providers to use online
            tracking technologies on our Services for analytics and
            advertising, including to help manage and display advertisements,
            to tailor advertisements to your interests, or to send abandoned
            shopping cart reminders (depending on your communication
            preferences). The third parties and service providers use their
            technology to provide advertising about products and services
            tailored to your interests which may appear either on our Services
            or on other websites.
          </p>
          <p>
            To the extent these online tracking technologies are deemed to be a
            &ldquo;sale&rdquo;/&ldquo;sharing&rdquo; (which includes targeted
            advertising, as defined under the applicable laws) under applicable
            US state laws, you can opt out of these online tracking
            technologies by submitting a request as described below under
            section{" "}
            <a href="#uslaws" className="text-[#22C55E] hover:underline">
              &ldquo;Do United States residents have specific privacy
              rights?&rdquo;
            </a>
          </p>
        </section>

        {/* 5. RETENTION */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="inforetain" number={5}>
            How long do we keep your information?
          </SectionHeading>
          <InShort>
            We keep your information for as long as necessary to fulfill the
            purposes outlined in this Privacy Notice unless otherwise required
            by law.
          </InShort>
          <p>
            We will only keep your personal information for as long as it is
            necessary for the purposes set out in this Privacy Notice, unless a
            longer retention period is required or permitted by law (such as
            tax, accounting, or other legal requirements). No purpose in this
            notice will require us keeping your personal information for longer
            than the period of time in which users have an account with us.
          </p>
          <p>
            When we have no ongoing legitimate business need to process your
            personal information, we will either delete or anonymize such
            information, or, if this is not possible (for example, because your
            personal information has been stored in backup archives), then we
            will securely store your personal information and isolate it from
            any further processing until deletion is possible.
          </p>
        </section>

        {/* 6. SAFETY */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="infosafe" number={6}>
            How do we keep your information safe?
          </SectionHeading>
          <InShort>
            We aim to protect your personal information through a system of
            organizational and technical security measures.
          </InShort>
          <p>
            We have implemented appropriate and reasonable technical and
            organizational security measures designed to protect the security
            of any personal information we process. However, despite our
            safeguards and efforts to secure your information, no electronic
            transmission over the Internet or information storage technology
            can be guaranteed to be 100% secure, so we cannot promise or
            guarantee that hackers, cybercriminals, or other unauthorized third
            parties will not be able to defeat our security and improperly
            collect, access, steal, or modify your information. Although we
            will do our best to protect your personal information, transmission
            of personal information to and from our Services is at your own
            risk. You should only access the Services within a secure
            environment.
          </p>
        </section>

        {/* 7. MINORS */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="infominors" number={7}>
            Do we collect information from minors?
          </SectionHeading>
          <InShort>
            We do not knowingly collect data from or market to children under
            18 years of age.
          </InShort>
          <p>
            We do not knowingly collect, solicit data from, or market to
            children under 18 years of age, nor do we knowingly sell such
            personal information. By using the Services, you represent that you
            are at least 18 or that you are the parent or guardian of such a
            minor and consent to such minor dependent&rsquo;s use of the
            Services. If we learn that personal information from users less
            than 18 years of age has been collected, we will deactivate the
            account and take reasonable measures to promptly delete such data
            from our records. If you become aware of any data we may have
            collected from children under age 18, please contact us at{" "}
            <a
              href="mailto:hello@thefieldslate.com"
              className="font-medium text-[#22C55E] hover:underline"
            >
              hello@thefieldslate.com
            </a>
            .
          </p>
        </section>

        {/* 8. RIGHTS */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="privacyrights" number={8}>
            What are your privacy rights?
          </SectionHeading>
          <InShort>
            You may review, change, or terminate your account at any time,
            depending on your country, province, or state of residence.
          </InShort>
          <p id="withdrawconsent" className="scroll-mt-24">
            <strong>
              <u>Withdrawing your consent:</u>
            </strong>{" "}
            If we are relying on your consent to process your personal
            information, which may be express and/or implied consent depending
            on the applicable law, you have the right to withdraw your consent
            at any time. You can withdraw your consent at any time by
            contacting us by using the contact details provided in the section{" "}
            <a href="#contact" className="text-[#22C55E] hover:underline">
              &ldquo;How can you contact us about this notice?&rdquo;
            </a>{" "}
            below.
          </p>
          <p>
            However, please note that this will not affect the lawfulness of
            the processing before its withdrawal nor, when applicable law
            allows, will it affect the processing of your personal information
            conducted in reliance on lawful processing grounds other than
            consent.
          </p>
          <p>
            <strong>
              <u>Opting out of marketing and promotional communications:</u>
            </strong>{" "}
            You can unsubscribe from our marketing and promotional
            communications at any time by clicking on the unsubscribe link in
            the emails that we send, or by contacting us using the details
            provided in the section{" "}
            <a href="#contact" className="text-[#22C55E] hover:underline">
              &ldquo;How can you contact us about this notice?&rdquo;
            </a>{" "}
            below. You will then be removed from the marketing lists. However,
            we may still communicate with you &mdash; for example, to send you
            service-related messages that are necessary for the administration
            and use of your account, to respond to service requests, or for
            other non-marketing purposes.
          </p>

          <h3 className="mt-6 text-lg font-semibold text-[#0C1F3F]">
            Account information
          </h3>
          <p>
            If you would at any time like to review or change the information
            in your account or terminate your account, you can:
          </p>
          <ul className="ml-6 list-disc space-y-1">
            <li>Log in to your account settings and update your user account.</li>
            <li>Contact us using the contact information provided.</li>
          </ul>
          <p>
            Upon your request to terminate your account, we will deactivate or
            delete your account and information from our active databases.
            However, we may retain some information in our files to prevent
            fraud, troubleshoot problems, assist with any investigations,
            enforce our legal terms and/or comply with applicable legal
            requirements.
          </p>
          <p>
            <strong>
              <u>Cookies and similar technologies:</u>
            </strong>{" "}
            Most Web browsers are set to accept cookies by default. If you
            prefer, you can usually choose to set your browser to remove
            cookies and to reject cookies. If you choose to remove cookies or
            reject cookies, this could affect certain features or services of
            our Services.
          </p>
          <p>
            If you have questions or comments about your privacy rights, you
            may email us at{" "}
            <a
              href="mailto:hello@thefieldslate.com"
              className="font-medium text-[#22C55E] hover:underline"
            >
              hello@thefieldslate.com
            </a>
            .
          </p>
        </section>

        {/* 9. DNT */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="dnt" number={9}>
            Controls for Do-Not-Track features
          </SectionHeading>
          <p>
            Most web browsers and some mobile operating systems and mobile
            applications include a Do-Not-Track (&ldquo;DNT&rdquo;) feature or
            setting you can activate to signal your privacy preference not to
            have data about your online browsing activities monitored and
            collected. At this stage, no uniform technology standard for
            recognizing and implementing DNT signals has been finalized. As
            such, we do not currently respond to DNT browser signals or any
            other mechanism that automatically communicates your choice not to
            be tracked online. If a standard for online tracking is adopted
            that we must follow in the future, we will inform you about that
            practice in a revised version of this Privacy Notice.
          </p>
          <p>
            California law requires us to let you know how we respond to web
            browser DNT signals. Because there currently is not an industry or
            legal standard for recognizing or honoring DNT signals, we do not
            respond to them at this time.
          </p>
        </section>

        {/* 10. US RIGHTS */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="uslaws" number={10}>
            Do United States residents have specific privacy rights?
          </SectionHeading>
          <InShort>
            If you are a resident of California, Colorado, Connecticut,
            Delaware, Florida, Indiana, Iowa, Kentucky, Maryland, Minnesota,
            Montana, Nebraska, New Hampshire, New Jersey, Oregon, Rhode Island,
            Tennessee, Texas, Utah, or Virginia, you may have the right to
            request access to and receive details about the personal
            information we maintain about you and how we have processed it,
            correct inaccuracies, get a copy of, or delete your personal
            information. You may also have the right to withdraw your consent
            to our processing of your personal information. These rights may be
            limited in some circumstances by applicable law. More information
            is provided below.
          </InShort>

          <h3 className="mt-6 text-lg font-semibold text-[#0C1F3F]">
            Categories of personal information we collect
          </h3>
          <p>
            The table below shows the categories of personal information we
            have collected in the past twelve (12) months. The table includes
            illustrative examples of each category and does not reflect the
            personal information we collect from you. For a comprehensive
            inventory of all personal information we process, please refer to
            the section{" "}
            <a href="#infocollect" className="text-[#22C55E] hover:underline">
              &ldquo;What information do we collect?&rdquo;
            </a>
          </p>

          <div className="overflow-x-auto">
            <table className="mt-2 w-full border-collapse border border-gray-200 text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-700">
                  <th className="border border-gray-200 px-3 py-2 font-semibold">
                    Category
                  </th>
                  <th className="border border-gray-200 px-3 py-2 font-semibold">
                    Examples
                  </th>
                  <th className="border border-gray-200 px-3 py-2 text-center font-semibold">
                    Collected
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    cat: "A. Identifiers",
                    ex: "Contact details, such as real name, alias, postal address, telephone or mobile contact number, unique personal identifier, online identifier, Internet Protocol address, email address, and account name",
                  },
                  {
                    cat: "B. Personal information as defined in the California Customer Records statute",
                    ex: "Name, contact information, education, employment, employment history, and financial information",
                  },
                  {
                    cat: "C. Protected classification characteristics under state or federal law",
                    ex: "Gender, age, date of birth, race and ethnicity, national origin, marital status, and other demographic data",
                  },
                  {
                    cat: "D. Commercial information",
                    ex: "Transaction information, purchase history, financial details, and payment information",
                  },
                  {
                    cat: "E. Biometric information",
                    ex: "Fingerprints and voiceprints",
                  },
                  {
                    cat: "F. Internet or other similar network activity",
                    ex: "Browsing history, search history, online behavior, interest data, and interactions with our and other websites, applications, systems, and advertisements",
                  },
                  {
                    cat: "G. Geolocation data",
                    ex: "Device location",
                  },
                  {
                    cat: "H. Audio, electronic, sensory, or similar information",
                    ex: "Images and audio, video or call recordings created in connection with our business activities",
                  },
                  {
                    cat: "I. Professional or employment-related information",
                    ex: "Business contact details in order to provide you our Services at a business level or job title, work history, and professional qualifications if you apply for a job with us",
                  },
                  {
                    cat: "J. Education information",
                    ex: "Student records and directory information",
                  },
                  {
                    cat: "K. Inferences drawn from collected personal information",
                    ex: "Inferences drawn from any of the collected personal information listed above to create a profile or summary about, for example, an individual's preferences and characteristics",
                  },
                  {
                    cat: "L. Sensitive personal information",
                    ex: "",
                  },
                ].map((row) => (
                  <tr key={row.cat}>
                    <td className="border border-gray-200 px-3 py-2 align-top">
                      {row.cat}
                    </td>
                    <td className="border border-gray-200 px-3 py-2 align-top text-gray-600">
                      {row.ex}
                    </td>
                    <td className="border border-gray-200 px-3 py-2 text-center align-middle font-semibold text-gray-700">
                      NO
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p>
            We may also collect other personal information outside of these
            categories through instances where you interact with us in person,
            online, or by phone or mail in the context of:
          </p>
          <ul className="ml-6 list-disc space-y-1">
            <li>Receiving help through our customer support channels;</li>
            <li>Participation in customer surveys or contests; and</li>
            <li>
              Facilitation in the delivery of our Services and to respond to
              your inquiries.
            </li>
          </ul>

          <h3 className="mt-6 text-lg font-semibold text-[#0C1F3F]">
            Sources of personal information
          </h3>
          <p>
            Learn more about the sources of personal information we collect in{" "}
            <a href="#infocollect" className="text-[#22C55E] hover:underline">
              &ldquo;What information do we collect?&rdquo;
            </a>
          </p>

          <h3 className="mt-6 text-lg font-semibold text-[#0C1F3F]">
            How we use and share personal information
          </h3>
          <p>
            Learn more about how we use your personal information in the
            section{" "}
            <a href="#infouse" className="text-[#22C55E] hover:underline">
              &ldquo;How do we process your information?&rdquo;
            </a>
          </p>

          <p>
            <strong>Will your information be shared with anyone else?</strong>{" "}
            We may disclose your personal information with our service
            providers pursuant to a written contract between us and each
            service provider. Learn more about how we disclose personal
            information in the section{" "}
            <a href="#whoshare" className="text-[#22C55E] hover:underline">
              &ldquo;When and with whom do we share your personal
              information?&rdquo;
            </a>
          </p>
          <p>
            We may use your personal information for our own business purposes,
            such as for undertaking internal research for technological
            development and demonstration. This is not considered to be
            &ldquo;selling&rdquo; of your personal information.
          </p>
          <p>
            We have not sold or shared any personal information to third
            parties for a business or commercial purpose in the preceding
            twelve (12) months.
          </p>
          <p>
            We have disclosed the following categories of personal information
            to third parties for a business or commercial purpose in the
            preceding twelve (12) months. The categories of third parties to
            whom we disclosed personal information for a business or commercial
            purpose can be found under{" "}
            <a href="#whoshare" className="text-[#22C55E] hover:underline">
              &ldquo;When and with whom do we share your personal
              information?&rdquo;
            </a>
          </p>

          <h3 className="mt-6 text-lg font-semibold text-[#0C1F3F]">
            Your rights
          </h3>
          <p>
            You have rights under certain US state data protection laws.
            However, these rights are not absolute, and in certain cases, we
            may decline your request as permitted by law. These rights include:
          </p>
          <ul className="ml-6 list-disc space-y-1">
            <li>
              <strong>Right to know</strong> whether or not we are processing
              your personal data
            </li>
            <li>
              <strong>Right to access</strong> your personal data
            </li>
            <li>
              <strong>Right to correct</strong> inaccuracies in your personal
              data
            </li>
            <li>
              <strong>Right to request</strong> the deletion of your personal
              data
            </li>
            <li>
              <strong>Right to obtain a copy</strong> of the personal data you
              previously shared with us
            </li>
            <li>
              <strong>Right to non-discrimination</strong> for exercising your
              rights
            </li>
            <li>
              <strong>Right to opt out</strong> of the processing of your
              personal data if it is used for targeted advertising (or sharing
              as defined under California&rsquo;s privacy law), the sale of
              personal data, or profiling in furtherance of decisions that
              produce legal or similarly significant effects
              (&ldquo;profiling&rdquo;)
            </li>
          </ul>
          <p>
            Depending upon the state where you live, you may also have the
            following rights:
          </p>
          <ul className="ml-6 list-disc space-y-1">
            <li>
              Right to access the categories of personal data being processed
              (as permitted by applicable law, including the privacy law in
              Minnesota)
            </li>
            <li>
              Right to obtain a list of the categories of third parties to
              which we have disclosed personal data (as permitted by applicable
              law, including the privacy law in California, Delaware, and
              Maryland)
            </li>
            <li>
              Right to obtain a list of specific third parties to which we have
              disclosed personal data (as permitted by applicable law,
              including the privacy law in Minnesota and Oregon)
            </li>
            <li>
              Right to obtain a list of third parties to which we have sold
              personal data (as permitted by applicable law, including the
              privacy law in Connecticut)
            </li>
            <li>
              Right to review, understand, question, and depending on where you
              live, correct how personal data has been profiled (as permitted
              by applicable law, including the privacy law in Connecticut and
              Minnesota)
            </li>
            <li>
              Right to limit use and disclosure of sensitive personal data (as
              permitted by applicable law, including the privacy law in
              California)
            </li>
            <li>
              Right to opt out of the collection of sensitive data and personal
              data collected through the operation of a voice or facial
              recognition feature (as permitted by applicable law, including
              the privacy law in Florida)
            </li>
          </ul>

          <h3 className="mt-6 text-lg font-semibold text-[#0C1F3F]">
            How to exercise your rights
          </h3>
          <p>
            To exercise these rights, you can contact us by visiting{" "}
            <a
              href="/contact"
              className="font-medium text-[#22C55E] hover:underline"
            >
              https://thefieldslate.com/contact
            </a>
            , by emailing us at{" "}
            <a
              href="mailto:hello@thefieldslate.com"
              className="font-medium text-[#22C55E] hover:underline"
            >
              hello@thefieldslate.com
            </a>
            , or by referring to the contact details at the bottom of this
            document.
          </p>
          <p>
            Under certain US state data protection laws, you can designate an
            authorized agent to make a request on your behalf. We may deny a
            request from an authorized agent that does not submit proof that
            they have been validly authorized to act on your behalf in
            accordance with applicable laws.
          </p>

          <h3 className="mt-6 text-lg font-semibold text-[#0C1F3F]">
            Request verification
          </h3>
          <p>
            Upon receiving your request, we will need to verify your identity
            to determine you are the same person about whom we have the
            information in our system. We will only use personal information
            provided in your request to verify your identity or authority to
            make the request. However, if we cannot verify your identity from
            the information already maintained by us, we may request that you
            provide additional information for the purposes of verifying your
            identity and for security or fraud-prevention purposes.
          </p>
          <p>
            If you submit the request through an authorized agent, we may need
            to collect additional information to verify your identity before
            processing your request and the agent will need to provide a
            written and signed permission from you to submit such request on
            your behalf.
          </p>

          <h3 className="mt-6 text-lg font-semibold text-[#0C1F3F]">Appeals</h3>
          <p>
            Under certain US state data protection laws, if we decline to take
            action regarding your request, you may appeal our decision by
            emailing us at{" "}
            <a
              href="mailto:hello@thefieldslate.com"
              className="font-medium text-[#22C55E] hover:underline"
            >
              hello@thefieldslate.com
            </a>
            . We will inform you in writing of any action taken or not taken in
            response to the appeal, including a written explanation of the
            reasons for the decisions. If your appeal is denied, you may submit
            a complaint to your state attorney general.
          </p>

          <h3 className="mt-6 text-lg font-semibold text-[#0C1F3F]">
            California &ldquo;Shine the Light&rdquo; law
          </h3>
          <p>
            California Civil Code Section 1798.83, also known as the
            &ldquo;Shine the Light&rdquo; law, permits our users who are
            California residents to request and obtain from us, once a year and
            free of charge, information about categories of personal
            information (if any) we disclosed to third parties for direct
            marketing purposes and the names and addresses of all third parties
            with which we shared personal information in the immediately
            preceding calendar year. If you are a California resident and would
            like to make such a request, please submit your request in writing
            to us by using the contact details provided in the section{" "}
            <a href="#contact" className="text-[#22C55E] hover:underline">
              &ldquo;How can you contact us about this notice?&rdquo;
            </a>
          </p>
        </section>

        {/* 11. UPDATES */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="policyupdates" number={11}>
            Do we make updates to this notice?
          </SectionHeading>
          <InShort>
            Yes, we will update this notice as necessary to stay compliant with
            relevant laws.
          </InShort>
          <p>
            We may update this Privacy Notice from time to time. The updated
            version will be indicated by an updated &ldquo;Revised&rdquo; date
            at the top of this Privacy Notice. If we make material changes to
            this Privacy Notice, we may notify you either by prominently
            posting a notice of such changes or by directly sending you a
            notification. We encourage you to review this Privacy Notice
            frequently to be informed of how we are protecting your
            information.
          </p>
        </section>

        {/* 12. CONTACT */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="contact" number={12}>
            How can you contact us about this notice?
          </SectionHeading>
          <p>
            If you have questions or comments about this notice, you may
            contact our Data Protection Officer (DPO) by email at{" "}
            <a
              href="mailto:hello@thefieldslate.com"
              className="font-medium text-[#22C55E] hover:underline"
            >
              hello@thefieldslate.com
            </a>
            , or contact us by post at:
          </p>
          <address className="not-italic">
            Whitney Mellon-King
            <br />
            Data Protection Officer
            <br />
            322 Yates Dr
            <br />
            Santa Rosa, CA 95405
            <br />
            United States
          </address>
        </section>

        {/* 13. REQUEST */}
        <section className="mt-12 space-y-4 text-sm leading-relaxed text-gray-700">
          <SectionHeading id="request" number={13}>
            How can you review, update, or delete the data we collect from you?
          </SectionHeading>
          <p>
            Based on the applicable laws of your country or state of residence
            in the US, you may have the right to request access to the personal
            information we collect from you, details about how we have
            processed it, correct inaccuracies, or delete your personal
            information. You may also have the right to withdraw your consent
            to our processing of your personal information. These rights may be
            limited in some circumstances by applicable law. To request to
            review, update, or delete your personal information, please visit:{" "}
            <a
              href="/contact"
              className="font-medium text-[#22C55E] hover:underline"
            >
              https://thefieldslate.com/contact
            </a>
            .
          </p>
        </section>

        {/* Back to top */}
        <div className="mt-16 border-t border-gray-100 pt-8 text-center">
          <Link
            href="/"
            className="text-sm text-gray-500 transition-colors hover:text-[#0C1F3F]"
          >
            &larr; Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
