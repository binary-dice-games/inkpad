# inkpad

inkpad is a new C++20 project, built with CMake. This repository is the
empty skeleton: a library, a command-line app, tests, CI and the
specification layout. Features are added project by project under
[spec/](spec/INDEX.md).

**Status:** skeleton only; `inkpad` prints its version.

## Build

```
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
build/app/inkpad        # Windows (MSVC): build\app\Debug\inkpad.exe
```

Dependencies are git submodules in `extern/`; configuring initializes them,
so `--recursive` is optional. See [docs/building.md](docs/building.md).

## Layout

| Path | Contents |
|------|----------|
| `include/inkpad/` | Public headers |
| `src/` | The `inkpad` library |
| `app/` | The `inkpad` executable |
| `tests/` | GoogleTest tests (`inkpad_add_test`) |
| `cmake/` | CMake modules |
| `spec/` | Design and plan documents, one folder per project |
| `docs/` | User and developer documentation |
| `extern/` | Third-party submodules (do not edit) |

## Further Documentation

| File | Contents |
|------|----------|
| [docs/building.md](docs/building.md) | Prerequisites and build instructions |
| [spec/INDEX.md](spec/INDEX.md) | Index of the project specifications |
| [CHANGELOG.md](CHANGELOG.md) | User-facing changes |

# MIT License © 2026 Carlos Lopez
