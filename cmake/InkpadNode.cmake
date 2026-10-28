# Finds Node.js and npm and installs the npm dependencies on first configure
# (the counterpart of lazily initializing submodules).
#
# Sets INKPAD_NODE and INKPAD_NPM.

find_program(INKPAD_NODE node)
# On Windows npm is a .cmd file; the extensionless `npm` next to it is a shell script that
# CreateProcess cannot run, so ask for npm.cmd first.
find_program(INKPAD_NPM NAMES npm.cmd npm)
if(NOT INKPAD_NODE OR NOT INKPAD_NPM)
  message(FATAL_ERROR "inkpad needs Node.js 20+ and npm on PATH (see docs/building.md)")
endif()

if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.package-lock.json")
  if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/package-lock.json")
    set(_inkpad_npm_install ci)
  else()
    set(_inkpad_npm_install install)
  endif()
  message(STATUS "inkpad: npm ${_inkpad_npm_install}")
  execute_process(
    COMMAND "${INKPAD_NPM}" ${_inkpad_npm_install} --no-audit --no-fund
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    RESULT_VARIABLE _inkpad_npm_result
    OUTPUT_VARIABLE _inkpad_npm_output
    ERROR_VARIABLE _inkpad_npm_output)
  if(NOT _inkpad_npm_result EQUAL 0)
    message(FATAL_ERROR "inkpad: npm ${_inkpad_npm_install} failed (${_inkpad_npm_result}):\n${_inkpad_npm_output}")
  endif()
endif()
