inkpad_ensure_submodules(extern/googletest)

set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
add_subdirectory("${PROJECT_SOURCE_DIR}/extern/googletest" "${PROJECT_BINARY_DIR}/googletest")

include(GoogleTest)

# Helper macro: creates a test executable linked with inkpad and GoogleTest.
macro(inkpad_add_test TESTNAME)
  add_executable(${TESTNAME} ${ARGN})
  target_link_libraries(${TESTNAME} PRIVATE inkpad::inkpad gtest gmock gtest_main)
  target_include_directories(${TESTNAME} PRIVATE "${PROJECT_BINARY_DIR}/generated")
  gtest_discover_tests(${TESTNAME})
endmacro()

inkpad_add_test(test_version test_version.cpp)
