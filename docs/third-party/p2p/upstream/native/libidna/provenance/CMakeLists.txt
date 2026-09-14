cmake_minimum_required(VERSION 4.0)

find_package(cmake-fetch REQUIRED PATHS node_modules/cmake-fetch)
find_package(cmake-fuzz REQUIRED PATHS node_modules/cmake-fuzz)
find_package(cmake-ucd REQUIRED PATHS node_modules/cmake-ucd)

project(idna C)

fetch_package("github:holepunchto/libutf")
fetch_package("github:holepunchto/libpunycode")
fetch_package("github:holepunchto/libnormalize")

include(cmake/tables.cmake)

add_library(idna OBJECT)

add_dependencies(idna idna_tables)

set_target_properties(
  idna
  PROPERTIES
  C_STANDARD 11
  POSITION_INDEPENDENT_CODE ON
)

target_sources(
  idna
  INTERFACE
    include/idna.h
    "${idna_tables_header}"
  PRIVATE
    src/idna.c
    "${idna_tables_source}"
)

target_include_directories(
  idna
  PUBLIC
    include
    "${CMAKE_CURRENT_BINARY_DIR}/include"
    $<TARGET_PROPERTY:utf,INTERFACE_INCLUDE_DIRECTORIES>
    $<TARGET_PROPERTY:punycode,INTERFACE_INCLUDE_DIRECTORIES>
    $<TARGET_PROPERTY:normalize,INTERFACE_INCLUDE_DIRECTORIES>
)

add_library(idna_shared SHARED)

set_target_properties(
  idna_shared
  PROPERTIES
  OUTPUT_NAME idna
  WINDOWS_EXPORT_ALL_SYMBOLS ON
)

target_link_libraries(
  idna_shared
  PUBLIC
    idna
    utf_shared
    punycode_shared
    normalize_shared
)

add_library(idna_static STATIC)

set_target_properties(
  idna_static
  PROPERTIES
  OUTPUT_NAME idna
  PREFIX lib
)

target_link_libraries(
  idna_static
  PUBLIC
    idna
    utf_static
    punycode_static
    normalize_static
)

install(TARGETS idna_shared idna_static)

install(FILES include/idna.h DESTINATION include)

install(FILES "${idna_tables_header}" DESTINATION include/idna)

if(PROJECT_IS_TOP_LEVEL)
  enable_testing()

  add_subdirectory(bench)
  add_subdirectory(test)
endif()
