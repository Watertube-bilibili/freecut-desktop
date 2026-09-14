cmake_minimum_required(VERSION 3.31)

find_package(cmake-fetch REQUIRED PATHS node_modules/cmake-fetch)
find_package(cmake-napi REQUIRED PATHS node_modules/cmake-napi)

project(bare_compat_napi C CXX)

add_library(bare_compat_napi INTERFACE)

set_target_properties(
  bare_compat_napi
  PROPERTIES
  C_STANDARD 11
  CXX_STANDARD 20
  POSITION_INDEPENDENT_CODE ON
)

target_sources(
  bare_compat_napi
  INTERFACE
    include/bare.h
    include/bare/module.h
    include/js.h
    include/utf.h
)

target_include_directories(
  bare_compat_napi
  INTERFACE
    include
)

if(PROJECT_IS_TOP_LEVEL)
  enable_testing()

  add_subdirectory(test)
endif()
