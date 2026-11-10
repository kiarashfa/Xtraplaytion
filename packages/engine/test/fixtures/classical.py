"""Reference fits with numpy/scipy (float64) for the classical model tests.

Usage: python packages/engine/test/fixtures/classical.py
Writes classical.json next to this file. The data has a gap, so the queries cover
inside, between and beyond the training points.
"""

import json
from pathlib import Path

import numpy as np
from numpy.polynomial import legendre

x = np.concatenate([np.linspace(-3.0, -0.8, 23), np.linspace(0.6, 2.5, 19)])
y = np.sin(1.3 * x) + 0.2 * np.cos(4.1 * x) + 0.05 * x * x
q = np.linspace(-4.5, 4.0, 61)
out = {"x": x.tolist(), "y": y.tolist(), "q": q.tolist()}

# Polynomial of degree 9 (Legendre basis on the data range, like the engine).
lo, hi = x.min(), x.max()
t = lambda v: (v - (lo + hi) / 2) / ((hi - lo) / 2)
coef = legendre.legfit(t(x), y, 9)
out["poly9"] = legendre.legval(t(q), coef).tolist()

# Fourier series with 6 harmonics, period = data span, origin at the first point.
P = hi - lo
w = 2 * np.pi / P


def fbasis(v, K):
    cols = [np.ones_like(v)]
    for k in range(1, K + 1):
        cols += [np.cos(k * w * (v - lo)), np.sin(k * w * (v - lo))]
    return np.stack(cols, axis=1)


c, *_ = np.linalg.lstsq(fbasis(x, 6), y, rcond=None)
out["fourier6"] = (fbasis(q, 6) @ c).tolist()

# Gaussian process, RBF + periodic, fixed hyperparameters (standardized targets).
mu, sd = y.mean(), y.std()
z = (y - mu) / sd
s1, l1 = 0.9, 0.7
s2, l2, p2 = 0.4, 1.1, 2.3
noise = 0.15


def kern(a, b):
    r = np.abs(a[:, None] - b[None, :])
    return s1**2 * np.exp(-(r**2) / (2 * l1**2)) + s2**2 * np.exp(
        -2 * np.sin(np.pi * r / p2) ** 2 / l2**2
    )


K = kern(x, x) + noise**2 * np.eye(len(x))
L = np.linalg.cholesky(K)
alpha = np.linalg.solve(K, z)
ks = kern(q, x)
mean = mu + sd * ks @ alpha
v = np.linalg.solve(L, ks.T)
var = s1**2 + s2**2 - np.sum(v * v, axis=0)
out["gp"] = {
    "kernel": [
        {"kind": "rbf", "scale": s1, "length": l1, "period": 1},
        {"kind": "periodic", "scale": s2, "length": l2, "period": p2},
    ],
    "noise": noise,
    "mean": mean.tolist(),
    "std": (sd * np.sqrt(np.maximum(var, 0))).tolist(),
    "evidence": float(
        -0.5 * z @ alpha - np.sum(np.log(np.diag(L))) - 0.5 * len(x) * np.log(2 * np.pi)
    ),
}

Path(__file__).with_name("classical.json").write_text(json.dumps(out))
print("wrote classical.json")
