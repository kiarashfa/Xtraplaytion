// Gallery: curated experiments. Each one is a preset, so its permalink is
// playground/#preset=<id>; the thumbnail is the finished race (src/gallery/thumbs.json,
// written by scripts/gallery.ts).

export interface GalleryItem {
  /** Preset id (also the anchor on the gallery page). */
  id: string;
  title: string;
  text: string;
  /** Lesson that explains it (slug), if any. */
  lesson?: string;
}

export const GALLERY: GalleryItem[] = [
  {
    id: 'race-width',
    title: '10, 100 or 1,000 neurons wide',
    text: 'Three ReLU networks of very different sizes learn the same three waves. Bigger is not always better.',
    lesson: 'width-depth-and-spectral-bias',
  },
  {
    id: 'race-activations',
    title: 'Who fills the gap?',
    text: 'ReLU, tanh and sin networks never see the middle of the wave. Each one fills the gap its own way.',
    lesson: 'activations-and-extrapolation',
  },
  {
    id: 'classic-beyond',
    title: 'Six ways to guess beyond the data',
    text: 'A polynomial explodes, a Fourier series repeats, a forest goes flat and a Gaussian process admits it does not know.',
    lesson: 'classical-models-out-of-range',
  },
  {
    id: 'overfit-net',
    title: 'Keep weights small',
    text: 'Three identical networks on noisy points. Without a penalty on big weights, one memorizes the noise.',
    lesson: 'noise-overfitting-and-regularization',
  },
  {
    id: 'lr-sweep',
    title: 'Too small, about right, too big',
    text: 'One network, three learning rates. The smallest crawls, the biggest jumps around, the middle one fits.',
    lesson: 'loss-curves-and-the-learning-rate',
  },
  {
    id: 'layout-crowded',
    title: 'Two hundred points in one place',
    text: 'A perfect fit where the data is crowded, and a guess everywhere else. Where the points sit matters more than how many.',
    lesson: 'where-to-put-training-data',
  },
  {
    id: 'ensemble',
    title: 'Five copies disagree',
    text: 'Five copies of one network agree on the data and spread out in the gap. Their spread is a rough measure of doubt.',
    lesson: 'ensembles-and-uncertainty',
  },
  {
    id: 'overfit-poly',
    title: 'Polynomials on noisy data',
    text: 'Degree 3 is too stiff and degree 15 chases the noise. Degree 7 finds the wave.',
    lesson: 'noise-overfitting-and-regularization',
  },
  {
    id: 'race-depth',
    title: 'Wide or deep?',
    text: 'One layer of 256 neurons against two of 32 and three of 16, with about the same number of weights.',
    lesson: 'width-depth-and-spectral-bias',
  },
  {
    id: 'classic-runge',
    title: 'Runge’s wiggles',
    text: 'A degree 20 polynomial swings wildly between evenly spaced points. The spline and the Gaussian process stay calm.',
    lesson: 'classical-models-out-of-range',
  },
  {
    id: 'classic-gap',
    title: 'Classical models in a gap',
    text: 'A polynomial, a spline, nearest neighbours, a Gaussian process and a network try to fill a hole in three waves.',
  },
  {
    id: 'race-shallow',
    title: 'One wide layer of ReLU',
    text: 'Single hidden layers of 81, 161 and 362 neurons on a fast wave riding a slope.',
  },
  {
    id: 'race-noisy-parabola',
    title: 'Small and big nets on a noisy parabola',
    text: 'Four tanh neurons, a mid-sized tanh net and a deep ReLU net see very noisy points of x². Beyond the data they part ways.',
  },
  {
    id: 'xsinx',
    title: 'Ten neurons against x sin(x)',
    text: 'A small ReLU network has only a few bends to spend, so the growing waves of x sin(x) come out as straight pieces.',
  },
  {
    id: 'bump',
    title: 'A sigmoid network on a noisy bump',
    text: 'The classic picture: a smooth network through noisy samples of 1/(1 + x²).',
  },
];
