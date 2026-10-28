add_executable(inkpad_app main.cpp)
set_target_properties(inkpad_app PROPERTIES OUTPUT_NAME inkpad)
target_link_libraries(inkpad_app PRIVATE inkpad::inkpad)
