# gambit-solver

WASM wrapper around [b-inary/postflop-solver](https://github.com/b-inary/postflop-solver) (AGPL-3.0-or-later),
used by the extension's "Analyse GTO". Single-threaded build (no rayon), so it runs in a plain Web Worker.

Rebuild after changing `src/lib.rs`:

```sh
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/release/gambit_solver.wasm --target no-modules --no-typescript --out-dir ../extension/solver
```

Needs `rustup target add wasm32-unknown-unknown` and `cargo install wasm-bindgen-cli --version 0.2.100`.
Because the solver is AGPL, the extension as a whole is AGPL when distributed.
