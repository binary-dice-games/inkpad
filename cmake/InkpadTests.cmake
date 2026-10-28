# inkpad_add_test(<name> <test file> [PROJECT <vitest project>] [LABELS <label>...])
#
# Registers one Vitest file as its own ctest test (ctest runs every test in
# its own process, in parallel). PROJECT is `unit` (default) or `e2e`.
# Node is run directly so Windows does not go through npm.cmd.
function(inkpad_add_test name file)
  cmake_parse_arguments(ARG "" "PROJECT" "LABELS" ${ARGN})
  if(NOT ARG_PROJECT)
    set(ARG_PROJECT unit)
  endif()
  add_test(
    NAME ${name}
    COMMAND "${INKPAD_NODE}" node_modules/vitest/vitest.mjs run --project ${ARG_PROJECT} "${file}"
    WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}")
  set_tests_properties(${name} PROPERTIES LABELS "${ARG_PROJECT};${ARG_LABELS}" TIMEOUT 120)
endfunction()
