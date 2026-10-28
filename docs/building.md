# inkpad — Building

inkpad targets **Linux, macOS and Windows (MSVC)**.

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| CMake | 3.14 | |
| C++ compiler | C++20 | GCC 10+, Clang 12+, MSVC 2022, AppleClang 15+ |
| Git | any | Required to check out submodules |

| Submodule | Version | Used for |
|-----------|---------|----------|
| `extern/googletest` | v1.15.2 | Tests only (`INKPAD_BUILD_TESTS`) |

To move a dependency to another version, check out the new commit inside
the submodule **and stage it** (`git add extern/<name>`).

## Options

| Option | Default | Meaning |
|--------|---------|---------|
| `INKPAD_BUILD_TESTS` | ON when top level | Build the tests |

## Build and test

```
cmake -S . -B build
cmake --build build --config Debug
ctest --test-dir build -C Debug --output-on-failure
```
