# heron-rubberband-sys

Vendored [Rubber Band Library](https://breakfastquay.com/rubberband/) v4.0.0
build for Heron. Sources live under `vendor/rubberband` and are compiled from
`single/RubberBandSingle.cpp` with no system package.

On Linux the build prefers `g++` when `CXX` is unset so hosts whose default
`c++` is a header-light Clang still succeed. macOS links Accelerate; Windows
uses MSVC via `cc-rs`.

Bindings are generated from `rubberband/rubberband-c.h` at build time.
