# https://cliutils.gitlab.io/modern-cmake/
# CMake is the entry point; the code is TypeScript/JavaScript built with npm.

cmake_minimum_required(VERSION 3.14...3.28)

project(
  Inksplat
  VERSION 0.1.0
  LANGUAGES NONE)

option(INKSPLAT_BUILD_TESTS "Register the inksplat tests with ctest" ${PROJECT_IS_TOP_LEVEL})

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(InksplatNode)
include(InksplatTests)

# Lint, typecheck and format check.
add_custom_target(
  check
  COMMAND "${INKSPLAT_NPM}" run check
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  COMMENT "inksplat: lint, typecheck, format check"
  VERBATIM)

# The viewer and presenter pages for GitHub Pages, in viewer/dist.
add_custom_target(
  viewer
  COMMAND "${INKSPLAT_NPM}" run build:viewer
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  COMMENT "inksplat: build the viewer and presenter pages"
  VERBATIM)

# The Pages site (viewer, presenter page, versioned copy, 404, privacy policy) in site/.
add_custom_target(
  site
  COMMAND "${INKSPLAT_NPM}" run build:site
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  COMMENT "inksplat: assemble the GitHub Pages site"
  VERBATIM)

if(INKSPLAT_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
