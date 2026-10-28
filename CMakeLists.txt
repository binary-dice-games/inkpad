# https://cliutils.gitlab.io/modern-cmake/
# CMake is the entry point; the code is TypeScript/JavaScript built with npm.

cmake_minimum_required(VERSION 3.14...3.28)

project(
  Inkpad
  VERSION 0.1.0
  LANGUAGES NONE)

option(INKPAD_BUILD_TESTS "Register the inkpad tests with ctest" ${PROJECT_IS_TOP_LEVEL})

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(InkpadNode)
include(InkpadTests)

# Lint, typecheck and format check.
add_custom_target(
  check
  COMMAND "${INKPAD_NPM}" run check
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  COMMENT "inkpad: lint, typecheck, format check"
  VERBATIM)

# The unpacked extension, in extension/dist (load it from chrome://extensions).
add_custom_target(
  extension
  COMMAND "${INKPAD_NPM}" run build:extension
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  COMMENT "inkpad: build the Chrome extension"
  VERBATIM)

# The viewer for GitHub Pages, in viewer/dist (the extension has its own copy).
add_custom_target(
  viewer
  COMMAND "${INKPAD_NPM}" run build:viewer
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  COMMENT "inkpad: build the viewer app"
  VERBATIM)

if(INKPAD_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
