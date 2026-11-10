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
];
