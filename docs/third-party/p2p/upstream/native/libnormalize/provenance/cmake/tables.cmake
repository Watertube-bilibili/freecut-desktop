# Generates the character tables needed to normalize, as specified by UAX #15
# <https://www.unicode.org/reports/tr15>, from the Unicode Character Database that
# cmake-ucd fetches.
#
# This defines the `normalize_tables` target, which generates:
#
#   ${normalize_tables_header}  The declarations of the character tables.
#   ${normalize_tables_source}  The definitions of the character tables.

set(normalize_tables_header "${CMAKE_CURRENT_BINARY_DIR}/include/normalize/tables.h")
set(normalize_tables_source "${CMAKE_CURRENT_BINARY_DIR}/normalize/tables.c")

ucd_fetch(
  UCD
    UnicodeData.txt
    CompositionExclusions.txt
    DerivedNormalizationProps.txt
  PATHS normalize_sources
)

if(PROJECT_IS_TOP_LEVEL)
  # The conformance test reads this, and nothing that is built does, so it is left
  # out of the tables the generator depends on.
  ucd_fetch(UCD NormalizationTest.txt)
endif()

find_program(NODE_EXECUTABLE NAMES node REQUIRED)

add_custom_command(
  OUTPUT
    "${normalize_tables_header}"
    "${normalize_tables_source}"
  COMMAND
    "${NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/generate-tables.mjs"
    "${ucd_version}"
    "${ucd_data}"
    "${normalize_tables_header}"
    "${normalize_tables_source}"
  DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/generate-tables.mjs"
    ${normalize_sources}
  COMMENT "Generating Unicode character tables"
  VERBATIM
)

add_custom_target(normalize_tables DEPENDS "${normalize_tables_header}" "${normalize_tables_source}")
