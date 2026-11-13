// The lessons, in reading order (index page, previous/next links, gallery).

export interface LessonInfo {
  n: number;
  slug: string;
  title: string;
  summary: string;
  minutes: number;
}

export const LESSONS: LessonInfo[] = [
  {
    n: 1,
    slug: 'activations-and-extrapolation',
    title: 'Activations and extrapolation',
    summary: 'Three networks, one gap in the data. Guess which one fills it, then watch them race.',
    minutes: 6,
  },
  {
    n: 2,
    slug: 'width-depth-and-spectral-bias',
    title: 'Width, depth and spectral bias',
    summary: 'A thousand neurons against ten. Then watch every network learn the slow wave first.',
    minutes: 7,
  },
  {
    n: 3,
    slug: 'noise-overfitting-and-regularization',
    title: 'Noise, overfitting and regularization',
    summary:
      'A model that hits every noisy point has learned the noise. See it happen, then tame it.',
    minutes: 7,
  },
  {
    n: 4,
    slug: 'classical-models-out-of-range',
    title: 'Classical models out of range',
    summary:
      'Polynomials explode, Fourier series repeat, trees go flat. See how six models guess beyond the data.',
    minutes: 7,
  },
  {
    n: 5,
    slug: 'loss-curves-and-the-learning-rate',
    title: 'Loss curves and the learning rate',
    summary: 'Too small, about right, too big. Read the story of training from its loss curve.',
    minutes: 7,
  },
  {
    n: 6,
    slug: 'where-to-put-training-data',
    title: 'Where to put your training data',
    summary: 'Two hundred points in one place or two dozen spread out? Coverage beats quantity.',
    minutes: 6,
  },
  {
    n: 7,
    slug: 'ensembles-and-uncertainty',
    title: 'Ensembles and uncertainty',
    summary:
      'Five copies of one network agree where there is data. Watch where they stop agreeing.',
    minutes: 7,
  },
  {
    n: 8,
    slug: 'draw-your-own-challenge',
    title: 'Draw your own challenge',
    summary: 'You draw the truth, the models see only the middle. Whose guess matches yours?',
    minutes: 6,
  },
];
