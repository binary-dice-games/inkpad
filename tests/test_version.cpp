// MIT License © 2026 Carlos Lopez
#include <gtest/gtest.h>
#include <inkpad/inkpad.hpp>
#include <version.hpp>
#include <string>

TEST(Version, MatchesProjectVersion) {
  const std::string expected = std::to_string(INKPAD_VERSION_MAJOR) + "." + std::to_string(INKPAD_VERSION_MINOR) + "." +
      std::to_string(INKPAD_VERSION_PATCH);
  EXPECT_EQ(inkpad::version(), expected);
  EXPECT_EQ(inkpad::version(), INKPAD_VERSION_STRING);
}
