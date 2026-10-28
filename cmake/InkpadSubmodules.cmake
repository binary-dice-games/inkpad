# Initializes git submodules lazily, so a checkout made without --recursive
# still configures. Usage: inkpad_ensure_submodules(extern/<name> ...)
function(inkpad_ensure_submodules)
  find_package(Git QUIET)
  foreach(_path IN LISTS ARGN)
    if(NOT EXISTS "${PROJECT_SOURCE_DIR}/${_path}/.git" AND GIT_FOUND)
      message(STATUS "Initializing submodule ${_path}")
      execute_process(
        COMMAND "${GIT_EXECUTABLE}" submodule update --init --recursive -- "${_path}"
        WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}"
        RESULT_VARIABLE _result)
      if(NOT _result EQUAL 0)
        message(FATAL_ERROR "Could not initialize submodule ${_path}")
      endif()
    endif()
  endforeach()
endfunction()
