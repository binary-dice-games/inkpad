add_library(inkpad inkpad.cpp)
add_library(inkpad::inkpad ALIAS inkpad)
target_include_directories(
  inkpad
  PUBLIC "${PROJECT_SOURCE_DIR}/include"
  PRIVATE "${PROJECT_BINARY_DIR}/generated")
target_compile_features(inkpad PUBLIC cxx_std_20)
