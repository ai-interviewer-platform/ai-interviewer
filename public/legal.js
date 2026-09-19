import { brandWordmark } from './brand.js';

const documents = {
  terms: {
    title: 'Terms of service',
    intro: 'The ground rules for using Coursay to practice, inspect your work, and try again.',
    sections: [
      ['About the service', '<p>Coursay is an educational coding-interview practice service. These terms describe use of the current preview. The guided sample contains fictional sessions, code, and feedback. Sample activity does not represent your personal performance.</p><p>Operator identity and a legal contact address are pending publication. These preview terms must be completed with those details before a public personal-data service is offered.</p>'],
      ['Using Coursay', '<p>Use the service only for lawful practice. Do not access another person’s account or records, bypass security controls, disrupt the service, or upload malicious material. Do not use the service to misrepresent assistance during an assessment where that assistance is prohibited.</p>'],
      ['Accounts and your work', '<p>Where account access is enabled, provide accurate account information and protect your sign-in credentials. Only submit code and other content that you have permission to use. Do not include confidential employer material, access credentials, or another person’s private information.</p><p>You retain ownership of your original work. Submitting it permits the service to process it to provide the practice features you request, subject to the <a href="#privacy">privacy notice</a>. It does not transfer ownership of your content.</p>'],
      ['Practice and AI limitations', '<p>Exercises and feedback support learning; they are not professional certifications, hiring decisions, or guarantees of interview success. AI responses can be incomplete or incorrect. Check explanations and code yourself before relying on them.</p><p>A visible control does not guarantee that a capability is available. Preview test results and reviews may be authored examples. Live voice, code execution, and personal records depend on the features enabled for the deployment.</p>'],
      ['Availability and ending use', '<p>The preview may change, be interrupted, or be withdrawn. Do not rely on it as the only copy of important work. Access may be restricted to protect users or address misuse. You may stop using the service at any time.</p><p>Closing a tab or signing out does not delete server-held account records. Demo deletion controls affect fictional history only. See the privacy notice for the current status of personal-data deletion.</p>'],
      ['Responsibility and your rights', '<p>The preview is provided as available, without a promise that it will be uninterrupted, error-free, or suitable for a particular assessment. Nothing in these terms excludes rights or responsibilities that applicable law does not allow to be excluded.</p>'],
      ['Changes and contact', '<p>Changes to these terms will be reflected on this page with an updated date. A verified operator name, contact channel, and any deployment-specific terms remain to be published. No paid subscription or purchase terms are established by this preview.</p>'],
    ],
  },
  privacy: {
    title: 'Privacy notice',
    intro: 'What the preview stores, what personal practice would process, and which decisions are still pending.',
    sections: [
      ['Scope and operator', '<p>This notice describes the current Coursay application. The operator’s legal identity and privacy contact have not yet been published. Personal practice is disabled by default until the deployment owner approves its data policy. This notice does not itself enable collection or approve that policy.</p>'],
      ['The guided sample', '<p>Sample sessions and findings are fictional. The sample does not create personal interview records or capture your microphone. The browser stores appearance choices, sample progress, and demo-history state in session storage so they can survive a reload in the same tab.</p><p>Loading the website still makes network requests. The hosting service receives connection information such as an IP address and request metadata. Fonts are loaded from Google Fonts, so your browser also connects to Google to request those files.</p>'],
      ['Personal practice, when enabled', '<p>Account functionality processes a display name, email address, password authentication data, and session information. Practice records can include submitted code, messages and transcripts, problem and mode selections, code checkpoints, test results, review feedback, corrections, and retry history.</p><p>These records support sign-in, saving and reopening attempts, providing practice and feedback, and protecting access to records. Avoid submitting sensitive personal information or secrets in code or conversation.</p>'],
      ['Voice and service providers', '<p>When live voice is enabled and you choose to use it, microphone audio is streamed through the application’s voice relay to Deepgram Voice Agent. The configured agent uses OpenAI for language-model responses. Transcripts can become part of the personal practice record. This application does not retain raw audio for replay.</p><p>Cloudflare provides application hosting, and personal records use a PostgreSQL database. Provider processing locations, contractual terms, retention, and any further processors must be disclosed and approved for the actual deployment before personal collection is enabled. No provider-level deletion or training guarantee is made by this preview notice.</p>'],
      ['Storage and retention', '<p>Demo state is kept in browser session storage, which normally lasts for the tab’s session; browser restore behavior may preserve it. Clearing this site’s browser data removes locally stored state. Authentication, when enabled, uses cookies to maintain a signed-in session.</p><p>A retention schedule for personal accounts, interview records, operational logs, and backups has not yet been published. The owner must establish retention periods or criteria and a deletion process before enabling personal collection. No automatic deletion deadline is promised here.</p>'],
      ['Your choices and requests', '<p>You can use the sample without an account, deny microphone permission, and use text where personal practice is available. Browser settings let you revoke microphone access and clear cookies and local storage.</p><p>The preview’s export and delete controls apply to example records, not real accounts. A verified channel for personal-data access, correction, export, deletion, objection, and consent withdrawal is pending. Rights and complaint options depend on the laws that apply to you; a relevant data-protection authority may provide further guidance.</p>'],
      ['Updates', '<p>This notice will be updated when deployment details or processing practices change. Before enabling personal collection, the operator must publish its identity, contact details, applicable processing basis, retention and deletion arrangements, and provider disclosures.</p>'],
    ],
  },
  cookies: {
    title: 'Cookies & storage',
    intro: 'A plain-language guide to the information kept in your browser.',
    sections: [
      ['Preview session storage', '<p>The preview uses a session-storage entry named <code>interview-prototype</code> to remember theme and motion preferences, prepared attempt progress, and fictional history state. This is browser storage, not a cookie. It normally lasts for the tab’s session and may survive browser session restoration.</p>'],
      ['Authentication cookies', '<p>When account access is enabled, authentication cookies let the service recognize your signed-in session. Blocking them can prevent sign-in from working. The sample does not require an account.</p>'],
      ['External requests', '<p>The application loads fonts from Google Fonts and is hosted on Cloudflare. Those requests expose connection metadata to the providers, even when you only view the sample. The maintained frontend does not include advertising or analytics tracking scripts.</p>'],
      ['Managing browser data', '<p>You can clear this site’s cookies and storage through your browser settings. This resets local preview choices and may sign you out. It does not delete personal records stored on a server. Microphone permission is managed separately in your browser’s site permissions.</p><p>For personal records, provider processing, and outstanding retention decisions, read the <a href="#privacy">privacy notice</a>.</p>'],
    ],
  },
};

export function pageFooter() {
  return `<footer class="page-footer"><div class="footer-brand">${brandWordmark(28)}<span>© 2026 Coursay</span></div><nav class="footer-links" aria-label="Legal"><a href="#terms">Terms of service</a><a href="#privacy">Privacy</a><a href="#cookies">Cookies & storage</a></nav></footer>`;
}

export function legalScreen(page) {
  const document = documents[page];
  return `<header class="page-title"><div><p class="eyebrow">Legal · Updated September 16, 2026</p><h1>${document.title}</h1><p>${document.intro}</p></div></header><div class="legal-layout"><nav class="legal-nav" aria-label="Legal pages">${Object.entries(documents).map(([key, value]) => `<a href="#${key}"${key === page ? ' aria-current="page"' : ''}>${value.title}</a>`).join('')}</nav><article class="legal-document" aria-label="${document.title}"><p class="legal-status">Preview notice · Operator and contact details are pending. Personal-data policy approval remains a separate requirement.</p>${document.sections.map(([title, body]) => `<section><h2>${title}</h2>${body}</section>`).join('')}</article></div>`;
}
