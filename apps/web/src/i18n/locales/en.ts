/**
 * English source catalog. Every user-facing string lives here so the UI can be
 * translated later. Keys are grouped by area. Messages use the ICU subset in
 * ../format.ts. Copy rule: short, friendly, no jargon walls.
 */
const en = {
  'site.description':
    'Train neural networks and classical models on a curve of your choice, live in your browser, and see how they interpolate, extrapolate and fail outside their data.',

  'nav.skip': 'Skip to content',

  'theme.label': 'Color theme',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  'home.title': 'See how models learn a curve, and where they break.',
  'home.lead':
    'Xtraplaytion is a playground for training neural networks and classical models on a function you choose, right in your browser. Watch them fit the data, fill the gaps, and guess what lies beyond it.',
  'home.status': 'Work in progress',
  'home.statusDetail': 'The first playable version is on its way.',
  'home.privacy':
    'Everything runs on your device. No account is needed, and your experiments never leave your browser.',
  'home.featuresTitle': 'What you will be able to do',
  'home.feature.target':
    'Pick a target: type a formula, choose a preset, draw a curve or paste data.',
  'home.feature.ood':
    'Choose where the training data lives, then compare interpolation and extrapolation side by side.',
  'home.feature.race':
    'Race up to six models, with your own layers, neurons and activation functions.',
  'home.feature.export': 'Export the animation as a video ready for social media.',

  'figure.label':
    'Illustration: a model fits noisy samples of a wave inside the training range, then drifts away from the true curve outside it.',
  'figure.train': 'Training range',
  'figure.extrapolation': 'Extrapolation',
  'figure.legend.target': 'True function',
  'figure.legend.data': 'Training data',
  'figure.legend.model': 'Model',

  'notFound.title': 'Page not found',
  'notFound.body': 'This page does not exist, or it moved.',
  'notFound.home': 'Go to the home page',

  'footer.copyright': '© {year} Kiarash Farajzadehahary',
  'footer.license': 'License',
  'footer.licenseNote': 'Source-available under the KFA Source-Available License 1.0',
  'footer.notices': 'Third-party notices',
  'footer.source': 'Source code',
  'footer.cookies': 'Cookie settings',
  'footer.label': 'Site links',

  'consent.label': 'Cookie consent',
  'consent.title': 'Analytics cookie?',
  'consent.body':
    'We would like to count visits with Google Analytics. It sets a cookie only if you accept, and your experiments are never sent.',
  'consent.accept': 'Accept',
  'consent.decline': 'Decline',

  'common.epochs': '{count, plural, one {# epoch} other {# epochs}}',
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;
export default en satisfies Catalog;
