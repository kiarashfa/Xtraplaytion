// "Copy as code": a plain, runnable Python script for the experiment. Networks in PyTorch
// or JAX, classical models in numpy / scikit-learn, the exact data points the site used,
// the true function as numpy when there is one, region scores and a plot.
import type { ClassicalConfig, Dataset, KernelPart, MLPConfig } from '@xtraplaytion/engine';
import { parse, type Expr } from '@xtraplaytion/expr';
import { GRID_SIZE } from './experiment.ts';
import type { ExperimentState } from './share.ts';

export type CodeFlavor = 'pytorch' | 'jax';

/** Shortest text that reads back as the same double in Python. */
const num = (v: number) => {
  if (Number.isNaN(v)) return 'np.nan';
  if (!Number.isFinite(v)) return v > 0 ? 'np.inf' : '-np.inf';
  const s = String(v);
  return /[.e]/.test(s) || s.includes('Infinity') ? s : `${s}.0`;
};

function array(name: string, values: ArrayLike<number>): string {
  if (!values.length) return `${name} = np.array([])`;
  const parts = Array.from(values, num);
  const lines: string[] = [];
  let line = '';
  for (const p of parts) {
    if (line.length + p.length + 2 > 92) {
      lines.push(line);
      line = '';
    }
    line += (line ? ', ' : '') + p;
  }
  lines.push(line);
  return `${name} = np.array([\n    ${lines.join(',\n    ')},\n])`;
}

// ------------------------------------------------------------ formula as numpy

const NP1: Record<string, string> = {
  sin: 'np.sin',
  cos: 'np.cos',
  tan: 'np.tan',
  asin: 'np.arcsin',
  acos: 'np.arccos',
  atan: 'np.arctan',
  sinh: 'np.sinh',
  cosh: 'np.cosh',
  tanh: 'np.tanh',
  exp: 'np.exp',
  ln: 'np.log',
  log2: 'np.log2',
  log10: 'np.log10',
  sqrt: 'np.sqrt',
  abs: 'np.abs',
  sign: 'np.sign',
  floor: 'np.floor',
  ceil: 'np.ceil',
  erf: 'erf',
};

function numpyOf(e: Expr): string {
  switch (e.type) {
    case 'num':
      return num(e.value);
    case 'var':
      return 'x';
    case 'const':
      return e.name === 'pi' ? 'np.pi' : e.name === 'e' ? 'np.e' : '(2 * np.pi)';
    case 'neg':
      return `(-${numpyOf(e.arg)})`;
    case 'bin': {
      const a = numpyOf(e.left);
      const b = numpyOf(e.right);
      return e.op === '^' ? `(${a} ** ${b})` : `(${a} ${e.op} ${b})`;
    }
    case 'cmp':
      return `(${numpyOf(e.left)} ${e.op} ${numpyOf(e.right)}).astype(float)`;
    case 'call': {
      const args = e.args.map(numpyOf);
      const f = NP1[e.fn];
      if (f) return `${f}(${args[0]})`;
      switch (e.fn) {
        case 'round':
          return `(np.sign(${args[0]}) * np.floor(np.abs(${args[0]}) + 0.5))`;
        case 'step':
          return `np.where(${args[0]} >= 0, 1.0, 0.0)`;
        case 'min':
          return args.reduce((acc, a) => `np.minimum(${acc}, ${a})`);
        case 'max':
          return args.reduce((acc, a) => `np.maximum(${acc}, ${a})`);
        case 'mod':
          return `np.mod(${args[0]}, ${args[1]})`;
        case 'atan2':
          return `np.arctan2(${args[0]}, ${args[1]})`;
        case 'clamp':
          return `np.minimum(np.maximum(${args[0]}, ${args[1]}), ${args[2]})`;
        case 'if':
          return `np.where(${args[0]} != 0, ${args[1]}, ${args[2]})`;
      }
      return 'np.nan';
    }
  }
}

const usesErf = (e: Expr): boolean =>
  e.type === 'call'
    ? e.fn === 'erf' || e.args.some(usesErf)
    : e.type === 'bin' || e.type === 'cmp'
      ? usesErf(e.left) || usesErf(e.right)
      : e.type === 'neg'
        ? usesErf(e.arg)
        : false;

// ------------------------------------------------------------ models

const TORCH_ACT: Record<string, string> = {
  relu: 'nn.ReLU()',
  leaky_relu: 'nn.LeakyReLU(0.01)',
  elu: 'nn.ELU()',
  gelu: 'nn.GELU()',
  silu: 'nn.SiLU()',
  softplus: 'nn.Softplus()',
  tanh: 'nn.Tanh()',
  sigmoid: 'nn.Sigmoid()',
  sin: 'Sin()',
  abs: 'Abs()',
  identity: 'nn.Identity()',
};

const JAX_ACT: Record<string, string> = {
  relu: 'jax.nn.relu',
  leaky_relu: 'lambda z: jax.nn.leaky_relu(z, 0.01)',
  elu: 'jax.nn.elu',
  gelu: 'lambda z: jax.nn.gelu(z, approximate=False)',
  silu: 'jax.nn.silu',
  softplus: 'jax.nn.softplus',
  tanh: 'jnp.tanh',
  sigmoid: 'jax.nn.sigmoid',
  sin: 'jnp.sin',
  abs: 'jnp.abs',
  identity: 'lambda z: z',
};

function torchOptimizer(c: MLPConfig): string {
  const o = c.optimizer;
  const lr = num(o.lr);
  const wd = o.weightDecay ? `, weight_decay=${num(o.weightDecay)}` : '';
  switch (o.kind) {
    case 'adam':
      return `torch.optim.Adam(model.parameters(), lr=${lr}${wd})`;
    case 'adamw':
      return `torch.optim.AdamW(model.parameters(), lr=${lr}${wd || ', weight_decay=0.01'})`;
    case 'sgd':
      return `torch.optim.SGD(model.parameters(), lr=${lr}${wd})`;
    case 'momentum':
      return `torch.optim.SGD(model.parameters(), lr=${lr}, momentum=0.9${wd})`;
    case 'nesterov':
      return `torch.optim.SGD(model.parameters(), lr=${lr}, momentum=0.9, nesterov=True${wd})`;
    case 'rmsprop':
      return `torch.optim.RMSprop(model.parameters(), lr=${lr}, alpha=0.99, eps=1e-8${wd})`;
  }
}

function jaxOptimizer(c: MLPConfig): string {
  const o = c.optimizer;
  const lr = num(o.lr);
  const base = (() => {
    switch (o.kind) {
      case 'adam':
        return `optax.adam(${lr})`;
      case 'adamw':
        return `optax.adamw(${lr}, weight_decay=${num(o.weightDecay ?? 0.01)})`;
      case 'sgd':
        return `optax.sgd(${lr})`;
      case 'momentum':
        return `optax.sgd(${lr}, momentum=0.9)`;
      case 'nesterov':
        return `optax.sgd(${lr}, momentum=0.9, nesterov=True)`;
      case 'rmsprop':
        return `optax.rmsprop(${lr}, decay=0.99, eps=1e-8, eps_in_sqrt=False)`;
    }
  })();
  // Coupled weight decay (as torch's weight_decay for the non-AdamW optimizers).
  return o.weightDecay && o.kind !== 'adamw'
    ? `optax.chain(optax.add_decayed_weights(${num(o.weightDecay)}), ${base})`
    : base;
}

const torchLoss = (c: MLPConfig) =>
  c.loss.kind === 'l1'
    ? 'nn.L1Loss()'
    : c.loss.kind === 'huber'
      ? `nn.HuberLoss(delta=${num(c.loss.delta ?? 1)})`
      : 'nn.MSELoss()';

const jaxLoss = (c: MLPConfig) =>
  c.loss.kind === 'l1'
    ? 'jnp.mean(jnp.abs(p - t))'
    : c.loss.kind === 'huber'
      ? `jnp.mean(optax.huber_loss(p, t, delta=${num(c.loss.delta ?? 1)}))`
      : 'jnp.mean((p - t) ** 2)';

function scaleLines(c: MLPConfig): { pre: string; post: string } {
  const s = c.scale;
  if (!s) return { pre: 'xs, ys, xv, yv, xg = X_train, y_train, X_val, y_val, grid', post: 'pred' };
  return {
    pre: [
      '# The network trains on rescaled values (x to [-1, 1] over the plot, y standardized).',
      `sx = lambda x: (x - ${num(s.xShift)}) * ${num(s.xScale)}`,
      `sy = lambda y: (y - ${num(s.yShift)}) * ${num(s.yScale)}`,
      'xs, ys, xv, yv, xg = sx(X_train), sy(y_train), sx(X_val), sy(y_val), sx(grid)',
    ].join('\n'),
    post: `pred / ${num(s.yScale)} + ${num(s.yShift)}`,
  };
}

function penaltyTorch(c: MLPConfig): string {
  const terms: string[] = [];
  if (c.l1) terms.push(`${num(c.l1)} * sum(w.abs().sum() for w in weights)`);
  if (c.l2) terms.push(`${num(c.l2)} * sum((w ** 2).sum() for w in weights)`);
  return terms.length ? ` + ${terms.join(' + ')}` : '';
}

function torchNet(name: string, c: MLPConfig, seed: number, epochs: number): string {
  const sizes = [1, ...c.hidden];
  const layers: string[] = [];
  c.hidden.forEach((w, i) => {
    layers.push(`nn.Linear(${sizes[i]}, ${w})`, TORCH_ACT[c.activations[i]] ?? 'nn.ReLU()');
  });
  layers.push(`nn.Linear(${c.hidden[c.hidden.length - 1]}, 1)`);
  const { pre, post } = scaleLines(c);
  const pen = penaltyTorch(c);
  return `
def train_${name}():
    """Network [${sizes.join(', ')}, 1]: ${c.activations.join(', ')}, ${c.optimizer.kind} lr ${c.optimizer.lr}, ${c.loss.kind} loss."""
    torch.manual_seed(${seed})  # same kind of start as the site (PyTorch's default init), not the same numbers
    ${pre.split('\n').join('\n    ')}
    model = nn.Sequential(
        ${layers.join(',\n        ')},
    )
    opt = ${torchOptimizer(c)}
    loss_fn = ${torchLoss(c)}
    X = torch.tensor(xs).reshape(-1, 1)
    Y = torch.tensor(ys).reshape(-1, 1)${pen ? '\n    weights = [m.weight for m in model if isinstance(m, nn.Linear)]' : ''}
    for epoch in range(${epochs}):  # full batch: one step per epoch
        opt.zero_grad()
        loss = loss_fn(model(X), Y)${pen}
        loss.backward()
        opt.step()
    with torch.no_grad():
        pred = model(torch.tensor(xg).reshape(-1, 1)).numpy().ravel()
    return ${post}
`;
}

function jaxNet(name: string, c: MLPConfig, seed: number, epochs: number): string {
  const sizes = [1, ...c.hidden, 1];
  const acts = c.activations.map((a) => JAX_ACT[a] ?? 'jax.nn.relu');
  const { pre, post } = scaleLines(c);
  const pens: string[] = [];
  if (c.l1) pens.push(`${num(c.l1)} * sum(jnp.abs(w).sum() for w, _ in params)`);
  if (c.l2) pens.push(`${num(c.l2)} * sum((w ** 2).sum() for w, _ in params)`);
  return `
def train_${name}():
    """Network [${sizes.join(', ')}]: ${c.activations.join(', ')}, ${c.optimizer.kind} lr ${c.optimizer.lr}, ${c.loss.kind} loss."""
    ${pre.split('\n').join('\n    ')}
    sizes = [${sizes.join(', ')}]
    acts = [${acts.join(', ')}]
    # PyTorch-style start: weights and biases uniform in +-1/sqrt(fan_in).
    keys = jax.random.split(jax.random.PRNGKey(${seed}), 2 * (len(sizes) - 1))
    params = []
    for i, (a, b) in enumerate(zip(sizes[:-1], sizes[1:])):
        bound = 1 / np.sqrt(a)
        w = jax.random.uniform(keys[2 * i], (a, b), minval=-bound, maxval=bound)
        c = jax.random.uniform(keys[2 * i + 1], (b,), minval=-bound, maxval=bound)
        params.append((w, c))

    def forward(params, x):
        h = x.reshape(-1, 1)
        for (w, c), act in zip(params[:-1], acts):
            h = act(h @ w + c)
        w, c = params[-1]
        return (h @ w + c).ravel()

    def loss_fn(params, x, t):
        p = forward(params, x)
        return ${jaxLoss(c)}${pens.length ? ` + ${pens.join(' + ')}` : ''}

    opt = ${jaxOptimizer(c)}
    state = opt.init(params)

    @jax.jit
    def step(params, state):
        g = jax.grad(loss_fn)(params, xs, ys)
        updates, state = opt.update(g, state, params)
        return optax.apply_updates(params, updates), state

    for epoch in range(${epochs}):  # full batch: one step per epoch
        params, state = step(params, state)
    pred = np.asarray(forward(params, xg))
    return ${post}
`;
}

/** Kernel for scikit-learn on u = (x - center) / half (lengths divided by half). */
function sklearnKernel(parts: KernelPart[]): string {
  return parts
    .map((p) => {
      const s2 = `C(${num(p.scale * p.scale)})`;
      const l = `${num(p.length)} / half`;
      switch (p.kind) {
        case 'rbf':
          return `${s2} * RBF(${l})`;
        case 'matern12':
          return `${s2} * Matern(${l}, nu=0.5)`;
        case 'matern32':
          return `${s2} * Matern(${l}, nu=1.5)`;
        case 'matern52':
          return `${s2} * Matern(${l}, nu=2.5)`;
        case 'periodic':
          return `${s2} * ExpSineSquared(${l}, ${num(p.period)} / half)`;
        case 'linear':
          return `${s2} * DotProduct(sigma_0=0.0)`;
      }
    })
    .join(' + ');
}

function classical(name: string, c: ClassicalConfig, seed: number): string {
  const head = `\ndef train_${name}():`;
  switch (c.kind) {
    case 'poly':
      return `${head}
    """Polynomial of degree ${c.degree} (least squares, Legendre basis on the training range)."""
    p = np.polynomial.Legendre.fit(X_train, y_train, ${c.degree}, domain=[X_train.min(), X_train.max()])
    return p(grid)
`;
    case 'fourier':
      return `${head}
    """Fourier series with ${c.harmonics} harmonics (least squares)."""
    lo = X_train.min()
    period = ${c.period > 0 ? num(c.period) : 'X_train.max() - lo  # the span of the data'}
    def basis(x):
        cols = [np.ones_like(x)]
        for k in range(1, ${c.harmonics} + 1):
            a = 2 * np.pi * k * (x - lo) / period
            cols += [np.cos(a), np.sin(a)]
        return np.stack(cols, axis=1)
    coef = np.linalg.lstsq(basis(X_train), y_train, rcond=None)[0]
    return basis(grid) @ coef
`;
    case 'spline':
      return `${head}
    """Smoothing spline: cubic B-splines on ${c.segments} equal pieces, penalty ${c.smoothing} on
    second differences (P-spline), straight lines beyond the data."""
    m, lam = ${c.segments}, ${num(c.smoothing)}
    lo, hi = X_train.min(), X_train.max()
    h = (hi - lo) / m
    def basis(x, slope=False):
        s = np.clip(np.floor((x - lo) / h), 0, m - 1).astype(int)
        u = (x - lo) / h - s
        v = 1 - u
        if slope:
            w = [-v * v / 2, (3 * u * u - 4 * u) / 2, (-3 * u * u + 2 * u + 1) / 2, u * u / 2]
        else:
            w = [v ** 3 / 6, (3 * u ** 3 - 6 * u ** 2 + 4) / 6, (-3 * u ** 3 + 3 * u ** 2 + 3 * u + 1) / 6, u ** 3 / 6]
        B = np.zeros((len(x), m + 3))
        for k in range(4):
            B[np.arange(len(x)), s + k] = w[k]
        return B
    n = len(X_train)
    D = np.diff(np.eye(m + 3), 2, axis=0)
    A = np.vstack([basis(X_train), np.sqrt(lam * n) * D, np.sqrt(1e-9 * n) * np.eye(m + 3)])
    b = np.concatenate([y_train, np.zeros(A.shape[0] - n)])
    coef = np.linalg.lstsq(A, b, rcond=None)[0]
    inside = basis(np.clip(grid, lo, hi)) @ coef
    ends = basis(np.array([lo, hi])) @ coef
    slopes = basis(np.array([lo, hi]), slope=True) @ coef / h
    out = inside.copy()
    out[grid < lo] = ends[0] + slopes[0] * (grid[grid < lo] - lo)
    out[grid > hi] = ends[1] + slopes[1] * (grid[grid > hi] - hi)
    return out
`;
    case 'knn':
      return `${head}
    """k nearest neighbours, k = ${c.k}, ${c.weights} weights."""
    from sklearn.neighbors import KNeighborsRegressor
    model = KNeighborsRegressor(n_neighbors=${c.k}, weights="${c.weights}")
    model.fit(X_train.reshape(-1, 1), y_train)
    return model.predict(grid.reshape(-1, 1))
`;
    case 'tree': {
      const model =
        c.ensemble === 'forest'
          ? `RandomForestRegressor(n_estimators=${c.trees}, max_depth=${c.depth}, min_samples_leaf=${c.minLeaf}, random_state=${seed})`
          : c.ensemble === 'boost'
            ? `GradientBoostingRegressor(n_estimators=${c.trees}, learning_rate=${num(c.lr)}, max_depth=${c.depth}, min_samples_leaf=${c.minLeaf})`
            : `DecisionTreeRegressor(max_depth=${c.depth}, min_samples_leaf=${c.minLeaf})`;
      const cls =
        c.ensemble === 'forest'
          ? 'from sklearn.ensemble import RandomForestRegressor'
          : c.ensemble === 'boost'
            ? 'from sklearn.ensemble import GradientBoostingRegressor'
            : 'from sklearn.tree import DecisionTreeRegressor';
      return `${head}
    """${c.ensemble === 'forest' ? `Random forest of ${c.trees} trees` : c.ensemble === 'boost' ? `Gradient boosting, ${c.trees} rounds` : 'Decision tree'}, depth ${c.depth}."""
    ${cls}
    model = ${model}
    model.fit(X_train.reshape(-1, 1), y_train)
    return model.predict(grid.reshape(-1, 1))
`;
    }
    case 'gp':
      return `${head}
    """Gaussian process (${c.kernel.map((k) => k.kind).join(' + ')} kernel), ${c.tune ? 'tuned by maximizing the evidence' : 'fixed settings (kernel ridge)'}."""
    from sklearn.gaussian_process import GaussianProcessRegressor
    from sklearn.gaussian_process.kernels import ConstantKernel as C, RBF, Matern, ExpSineSquared, DotProduct, WhiteKernel
    lo, hi = X_train.min(), X_train.max()
    center, half = (lo + hi) / 2, max((hi - lo) / 2, 1e-12)
    u = lambda x: ((x - center) / half).reshape(-1, 1)
    kernel = ${sklearnKernel(c.kernel)}
    ${
      c.tune
        ? `model = GaussianProcessRegressor(kernel + WhiteKernel(${num(c.noise * c.noise)}), normalize_y=True, random_state=${seed})`
        : `model = GaussianProcessRegressor(kernel, alpha=${num(c.noise * c.noise)}, optimizer=None, normalize_y=True)`
    }
    model.fit(u(X_train), y_train)
    return model.predict(u(grid))
`;
  }
}

// ------------------------------------------------------------ whole script

export interface CodeInput {
  state: ExperimentState;
  data: Dataset;
  /** Display names of the models (N1, P2...), same order as state.models. */
  names: string[];
}

export function generateCode(flavor: CodeFlavor, { state, data, names }: CodeInput): string {
  const nets = state.models.filter((m) => m.model.kind === 'mlp');
  const anyClassical = state.models.some((m) => m.model.kind !== 'mlp');
  const src = state.source;
  const parsed = src ? null : parse(state.expr);
  const expr = parsed?.ok ? parsed.expr : null;
  const needs = ['numpy', 'matplotlib'];
  if (nets.length) needs.push(flavor === 'pytorch' ? 'torch' : 'jax optax');
  if (anyClassical) needs.push('scikit-learn');
  if (expr && usesErf(expr)) needs.push('scipy');

  const out: string[] = [];
  out.push(`# Xtraplaytion experiment as a Python script.
# Install: pip install ${needs.join(' ')}
# The data points below are exactly the ones the site trained on. Networks start from
# different random numbers than the site (same kind of start), so expect similar results,
# not identical ones.
import numpy as np
import matplotlib.pyplot as plt`);
  if (expr && usesErf(expr)) out.push('from scipy.special import erf');
  if (nets.length && flavor === 'pytorch')
    out.push(`import torch
import torch.nn as nn

torch.set_default_dtype(torch.float64)


class Sin(nn.Module):
    def forward(self, x):
        return torch.sin(x)


class Abs(nn.Module):
    def forward(self, x):
        return torch.abs(x)`);
  if (nets.length && flavor === 'jax')
    out.push(`import jax
import jax.numpy as jnp
import optax

jax.config.update("jax_enable_x64", True)`);

  out.push(
    `\n# ---- data (${data.trainX.length} training and ${data.valX.length} validation points)`,
  );
  out.push(array('X_train', data.trainX), array('y_train', data.trainY));
  out.push(array('X_val', data.valX), array('y_val', data.valY));
  if (data.test) {
    out.push('# Held-out points outside the training ranges (they score the gap and beyond).');
    out.push(array('X_test', data.test.x), array('y_test', data.test.y));
  }
  out.push(`grid = np.linspace(${num(state.domain[0])}, ${num(state.domain[1])}, ${GRID_SIZE})`);
  out.push(
    `bands = [${state.bands.map(([a, b]) => `(${num(a)}, ${num(b)})`).join(', ')}]  # where the training data lives`,
  );

  if (expr) {
    out.push(`\n\ndef truth(x):
    """f(x) = ${state.expr.replace(/"/g, "'")}"""
    with np.errstate(all="ignore"):
        return ${numpyOf(expr)} + 0 * x`);
  } else if (src?.kind === 'drawn') {
    out.push(`\n# The drawn curve: values at evenly spaced points, joined by straight lines.
${array('knots', src.ys)}


def truth(x):
    xs = np.linspace(${num(src.x0)}, ${num(src.x1)}, len(knots))
    return np.where((x >= xs[0]) & (x <= xs[-1]), np.interp(x, xs, knots), np.nan)`);
  }

  out.push(`

def region(x):
    """0 inside the training ranges, 1 in a gap between them, 2 beyond them."""
    if not bands:
        return np.zeros_like(x, dtype=int)
    inside = np.any([(x >= a) & (x <= b) for a, b in bands], axis=0)
    lo, hi = min(a for a, _ in bands), max(b for _, b in bands)
    return np.where(inside, 0, np.where((x < lo) | (x > hi), 2, 1))


def scores(pred):
    """Error (RMSE) per region, ${data.test ? 'on the held-out points (read off the grid)' : 'against the true function on the grid'}."""
    out = {}`);
  if (data.test)
    out.push(`    p_train = np.interp(X_train, grid, pred)
    p_test = np.interp(X_test, grid, pred)
    r = region(X_test)
    out["inside"] = np.sqrt(np.mean((p_train - y_train) ** 2))
    for k, label in [(1, "gap"), (2, "beyond")]:
        if np.any(r == k):
            out[label] = np.sqrt(np.mean((p_test[r == k] - y_test[r == k]) ** 2))
    return out`);
  else
    out.push(`    t, r = truth(grid), region(grid)
    for k, label in [(0, "inside"), (1, "gap"), (2, "beyond")]:
        m = (r == k) & np.isfinite(t)
        if m.any():
            out[label] = np.sqrt(np.mean((pred[m] - t[m]) ** 2))
    return out`);

  // Python names: the model's name without the copy count ("N1 ×5" gives N1).
  const ids = state.models.map((_, i) =>
    (names[i] ?? `M${i + 1}`).split(' ')[0].replace(/\W/g, ''),
  );
  state.models.forEach((m, i) => {
    const name = ids[i];
    const c = m.model;
    if (m.copies && m.copies > 1)
      out.push(
        `\n# On the site, ${name} is the average of ${m.copies} copies (${c.kind === 'mlp' ? 'different starting weights' : 'resampled training data'}). This script trains one.`,
      );
    if (c.kind === 'mlp')
      out.push(
        flavor === 'pytorch'
          ? torchNet(name, c, m.seed, state.epochs)
          : jaxNet(name, c, m.seed, state.epochs),
      );
    else out.push(classical(name, c, m.seed));
  });

  out.push(`
preds = {}
${ids.map((id) => `preds["${id}"] = train_${id}()`).join('\n')}
for name, pred in preds.items():
    print(name, {k: round(float(v), 4) for k, v in scores(pred).items()})

fig, ax = plt.subplots(figsize=(9, 5))
for a, b in bands:
    ax.axvspan(a, b, color="#e8d9b5", alpha=0.5, lw=0)
ax.scatter(X_train, y_train, s=10, color="#D55E00", label="training data")
ax.scatter(X_val, y_val, s=10, facecolors="none", edgecolors="#D55E00", label="validation")${
    data.test
      ? `
ax.scatter(X_test, y_test, s=12, marker="x", color="gray", label="held out")`
      : `
ax.plot(grid, truth(grid), ":", color="gray", label="true function")`
  }
for name, pred in preds.items():
    ax.plot(grid, pred, lw=2, label=name)
ax.set_ylim(*np.nanpercentile(np.concatenate([y_train, y_val]), [0, 100]) + np.array([-1, 1]) * np.ptp(y_train) * 0.3)
ax.legend()
plt.show()
`);
  return out.join('\n');
}
