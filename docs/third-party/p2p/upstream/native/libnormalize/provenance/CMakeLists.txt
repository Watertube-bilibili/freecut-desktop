cmake_minimum_required(VERSION 4.0)

find_package(cmake-fetch REQUIRED PATHS node_modules/cmake-fetch)
find_package(cmake-fuzz REQUIRED PATHS node_modules/cmake-fuzz)
find_package(cmake-ucd REQUIRED PATHS node_modules/cmake-ucd)

project(normalize C)

fetch_package("github:holepunchto/libutf")

include(cmake/tables.cmake)

add_library(normalize OBJECT)

add_dependencies(normalize normalize_tables)

set_target_properties(
  normalize
  PROPERTIES
  C_STANDARD 11
  POSITION_INDEPENDENT_CODE ON
)

target_sources(
  normalize
  INTERFACE
    include/normalize.h
    "${normalize_tables_header}"
  PRIVATE
    src/normalize.c
    "${normalize_tables_source}"
)

target_include_directories(
  normalize
  PUBLIC
    include
    "${CMAKE_CURRENT_BINARY_DIR}/include"
    $<TARGET_PROPERTY:utf,INTERFACE_INCLUDE_DIRECTORIES>
)

add_library(normalize_shared SHARED)

set_target_properties(
  normalize_shared
  PROPERTIES
  OUTPUT_NAME normalize
  WINDOWS_EXPORT_ALL_SYMBOLS ON
)

target_link_libraries(
  normalize_shared
  PUBLIC
    normalize
    utf_shared
)

add_library(normalize_static STATIC)

set_target_properties(
  normalize_static
  PROPERTIES
  OUTPUT_NAME normalize
  PREFIX lib
)

target_link_libraries(
  normalize_static
  PUBLIC
    normalize
    utf_static
)

install(TARGETS normalize_shared normalize_static)

install(FILES include/normalize.h DESTINATION include)

install(FILES "${normalize_tables_header}" DESTINATION include/normalize)

if(PROJECT_IS_TOP_LEVEL)
  enable_testing()
  add_subdirectory(bench)
  add_subdirectory(test)
endif()
