# Generates the character tables needed to convert a domain, as specified by UTS #46
# <https://www.unicode.org/reports/tr46>, from the Unicode Character Database that
# cmake-ucd fetches.
#
# This defines the `idna_tables` target, which generates:
#
#   ${idna_tables_header}  The declarations of the character tables.
#   ${idna_tables_source}  The definitions of the character tables.

set(idna_tables_header "${CMAKE_CURRENT_BINARY_DIR}/include/idna/tables.h")
set(idna_tables_source "${CMAKE_CURRENT_BINARY_DIR}/idna/tables.c")

ucd_fetch(
  EXTRACTED
    DerivedBidiClass.txt
    DerivedGeneralCategory.txt
    DerivedJoiningType.txt
  PATHS idna_sources
)

ucd_fetch(
  IDNA
    IdnaMappingTable.txt
  PATHS idna_sources
)

if(PROJECT_IS_TOP_LEVEL)
  # The conformance test reads this, and nothing that is built does, so it is left
  # out of the tables the generator depends on.
  ucd_fetch(IDNA IdnaTestV2.txt)
endif()

find_program(NODE_EXECUTABLE NAMES node REQUIRED)

add_custom_command(
  OUTPUT
    "${idna_tables_header}"
    "${idna_tables_source}"
  COMMAND
    "${NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/generate-tables.mjs"
    "${ucd_version}"
    "${ucd_data}"
    "${idna_tables_header}"
    "${idna_tables_source}"
  DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/generate-tables.mjs"
    ${idna_sources}
  COMMENT "Generating Unicode character tables"
  VERBATIM
)

add_custom_target(idna_tables DEPENDS "${idna_tables_header}" "${idna_tables_source}")
