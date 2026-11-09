"""Golden reference runs with PyTorch (float64) for the engine tests.

Usage: python packages/engine/test/fixtures/generate.py
Writes torch.json next to this file. Each case stores the data, the initial
parameters (in the engine's layout: per layer W row-major [out x in], then b),
the loss of every epoch and the final parameters.
"""

import json
import math
from pathlib import Path

import numpy as np
import torch

torch.set_default_dtype(torch.float64)

ACT = {
    "relu": torch.nn.ReLU,
    "leaky_relu": lambda: torch.nn.LeakyReLU(0.01),
    "elu": lambda: torch.nn.ELU(1.0),
    "gelu": lambda: torch.nn.GELU(approximate="none"),
    "silu": torch.nn.SiLU,
    "softplus": lambda: torch.nn.Softplus(beta=1.0, threshold=20.0),
    "tanh": torch.nn.Tanh,
    "sigmoid": torch.nn.Sigmoid,
    "identity": torch.nn.Identity,
}


class Sin(torch.nn.Module):
    def forward(self, x):
        return torch.sin(x)


class Abs(torch.nn.Module):
    def forward(self, x):
        return torch.abs(x)


ACT["sin"] = Sin
ACT["abs"] = Abs

CASES = [
    dict(name="relu_adam_mse", hidden=[8, 8], acts=["relu", "relu"], opt=dict(kind="adam", lr=1e-2), loss="mse"),
    dict(name="tanh_sgd_mse", hidden=[6, 5], acts=["tanh", "tanh"], opt=dict(kind="sgd", lr=0.05), loss="mse"),
    dict(name="gelu_momentum_l1", hidden=[7], acts=["gelu"], opt=dict(kind="momentum", lr=0.01), loss="l1"),
    dict(name="silu_nesterov_huber", hidden=[6, 6], acts=["silu", "elu"], opt=dict(kind="nesterov", lr=0.01), loss="huber", delta=0.4),
    dict(name="sigmoid_rmsprop", hidden=[8], acts=["sigmoid"], opt=dict(kind="rmsprop", lr=3e-3), loss="mse"),
    dict(name="softplus_adamw", hidden=[6, 6], acts=["softplus", "leaky_relu"], opt=dict(kind="adamw", lr=5e-3, weightDecay=0.05), loss="mse"),
    dict(name="sin_adam_wd_penalties", hidden=[5, 5], acts=["sin", "abs"], opt=dict(kind="adam", lr=5e-3, weightDecay=1e-3), loss="mse", l1=1e-3, l2=1e-2),
    dict(name="tanh_adam_minibatch_cosine", hidden=[6], acts=["tanh"], opt=dict(kind="adam", lr=1e-2), loss="mse", batch=7, cosine=(1e-4, 25)),
]

N = 40
EPOCHS = 25


def build(case):
    dims = [1, *case["hidden"], 1]
    layers = []
    for i in range(len(dims) - 1):
        layers.append(torch.nn.Linear(dims[i], dims[i + 1]))
        if i < len(case["acts"]):
            layers.append(ACT[case["acts"][i]]())
    return torch.nn.Sequential(*layers), dims


def flat(model):
    out = []
    for m in model:
        if isinstance(m, torch.nn.Linear):
            out += m.weight.detach().reshape(-1).tolist() + m.bias.detach().reshape(-1).tolist()
    return out


def optimizer(case, params):
    o = case["opt"]
    k = o["kind"]
    wd = o.get("weightDecay", 0.0)
    if k == "sgd":
        return torch.optim.SGD(params, lr=o["lr"], weight_decay=wd)
    if k == "momentum":
        return torch.optim.SGD(params, lr=o["lr"], momentum=0.9, weight_decay=wd)
    if k == "nesterov":
        return torch.optim.SGD(params, lr=o["lr"], momentum=0.9, nesterov=True, weight_decay=wd)
    if k == "rmsprop":
        return torch.optim.RMSprop(params, lr=o["lr"], alpha=0.99, eps=1e-8, weight_decay=wd)
    if k == "adam":
        return torch.optim.Adam(params, lr=o["lr"], weight_decay=wd)
    if k == "adamw":
        return torch.optim.AdamW(params, lr=o["lr"], weight_decay=wd)
    raise ValueError(k)


def loss_fn(case):
    if case["loss"] == "mse":
        return torch.nn.MSELoss()
    if case["loss"] == "l1":
        return torch.nn.L1Loss()
    return torch.nn.HuberLoss(delta=case["delta"])


def penalty(case, model):
    l1 = case.get("l1", 0.0)
    l2 = case.get("l2", 0.0)
    total = torch.zeros(())
    for m in model:
        if isinstance(m, torch.nn.Linear):
            if l1:
                total = total + l1 * m.weight.abs().sum()
            if l2:
                total = total + l2 * (m.weight**2).sum()
    return total


def run(case, seed):
    rng = np.random.RandomState(seed)
    model, dims = build(case)
    with torch.no_grad():
        for m in model:
            if isinstance(m, torch.nn.Linear):
                bound = math.sqrt(6.0 / m.in_features)
                m.weight.copy_(torch.tensor(rng.uniform(-bound, bound, m.weight.shape)))
                m.bias.copy_(torch.tensor(rng.uniform(-0.1, 0.1, m.bias.shape)))
    x = np.linspace(-3.0, 3.0, N)
    y = np.sin(2.0 * x) + 0.3 * x
    X = torch.tensor(x).reshape(-1, 1)
    Y = torch.tensor(y).reshape(-1, 1)
    init = flat(model)
    opt = optimizer(case, model.parameters())
    crit = loss_fn(case)
    batch = case.get("batch", N)
    losses = []
    for epoch in range(EPOCHS):
        if "cosine" in case:
            min_lr, total = case["cosine"]
            t = min(epoch, total)
            for g in opt.param_groups:
                g["lr"] = min_lr + 0.5 * (case["opt"]["lr"] - min_lr) * (1 + math.cos(math.pi * t / total))
        weighted = 0.0
        for s in range(0, N, batch):
            xb, yb = X[s : s + batch], Y[s : s + batch]
            opt.zero_grad()
            data_loss = crit(model(xb), yb)
            (data_loss + penalty(case, model)).backward()
            opt.step()
            weighted += data_loss.item() * len(xb)
        losses.append(weighted / N)
    return dict(
        case,
        dims=dims,
        x=x.tolist(),
        y=y.tolist(),
        init=init,
        losses=losses,
        final=flat(model),
    )


def main():
    out = dict(torch=torch.__version__, epochs=EPOCHS, cases=[run(c, 100 + i) for i, c in enumerate(CASES)])
    path = Path(__file__).with_name("torch.json")
    path.write_text(json.dumps(out) + "\n", encoding="utf8")
    print(f"wrote {path} ({len(out['cases'])} cases, torch {torch.__version__})")


if __name__ == "__main__":
    main()
