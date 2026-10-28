# Finds Node.js and npm and installs the npm dependencies on first configure
# (the counterpart of lazily initializing submodules).
#
# Sets INKPAD_NODE and INKPAD_NPM.

find_program(INKPAD_NODE node)
find_program(INKPAD_NPM npm)
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
    RESULT_VARIABLE _inkpad_npm_result)
  if(NOT _inkpad_npm_result EQUAL 0)
    message(FATAL_ERROR "inkpad: npm ${_inkpad_npm_install} failed")
  endif()
endif()
