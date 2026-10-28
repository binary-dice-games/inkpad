# https://cliutils.gitlab.io/modern-cmake/

cmake_minimum_required(VERSION 3.14...3.28)

project(
  Inkpad
  VERSION 0.1.0
  LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(INKPAD_BUILD_TESTS "Build the inkpad tests" ${PROJECT_IS_TOP_LEVEL})

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(InkpadSubmodules)

configure_file(src/version.hpp.in "${PROJECT_BINARY_DIR}/generated/version.hpp" @ONLY)

add_subdirectory(src)
add_subdirectory(app)

if(INKPAD_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
