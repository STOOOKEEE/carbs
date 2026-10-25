cmake_minimum_required(VERSION 3.10)
project(test_parser C)

include(CTest)

set(CMAKE_C_STANDARD 11)

if (NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE "Debug")
endif()

set(CMAKE_C_FLAGS_DEBUG "${CMAKE_C_FLAGS_DEBUG} -g -O0 --coverage")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} --coverage -lgcov")

enable_testing()

include_directories(
  include
  ../src
  ../src/xrp
  ../src/apdu/messages
  ../src/apdu
  ../src/policy
)

add_library(xrp
  ../src/xrp/amount.c
  ../src/xrp/amount.h
  ../src/xrp/array.h
  ../src/xrp/batch.c
  ../src/xrp/batch.h
  ../src/xrp/fields.c
  ../src/xrp/fields.h
  ../src/xrp/field_sort.c
  ../src/xrp/field_sort.h
  ../src/xrp/flags.c
  ../src/xrp/flags.h
  ../src/xrp/fmt.c
  ../src/xrp/fmt.h
  ../src/xrp/general.c
  ../src/xrp/general.h
  ../src/xrp/number_helpers.c
  ../src/xrp/number_helpers.h
  ../src/xrp/percentage.c
  ../src/xrp/percentage.h
  ../src/xrp/readers.c
  ../src/xrp/readers.h
  ../src/xrp/ascii_strings.c
  ../src/xrp/ascii_strings.h
  ../src/xrp/session_permissions.c
  ../src/xrp/session_permissions.h
  ../src/xrp/signing_session.h
  ../src/xrp/time.c
  ../src/xrp/time.h
  ../src/xrp/transaction_types.h
  ../src/xrp/xrp_helpers.c
  ../src/xrp/xrp_helpers.h
  ../src/xrp/xrp_parse.c
  ../src/xrp/xrp_parse.h
  ../src/policy/session_policy.c
  ../src/policy/session_policy.h
  ../src/policy/session_profiles.c
  ../src/policy/session_profiles.h
)

add_executable(test_printers
  src/test_printers.c
  src/cx.c
  include/bolos_target.h
  include/cx.h
  include/os.h
)

add_executable(test_swap
  src/test_swap.c
  src/cx.c
  include/bolos_target.h
  include/cx.h
  include/os.h
  )

add_executable(test_tx
  src/test_tx.c
  src/cx.c
  include/bolos_target.h
  include/cx.h
  include/os.h
)

# carbs: the ML-DSA-44 path (src/pq/pq_root.c) with the real entry.c and
# global.c; include_pq holds the test doubles of the SDK headers it needs.
add_executable(test_pq_root
  src/test_pq_root.c
  src/cx.c
)
target_include_directories(test_pq_root PRIVATE
  include_pq
  ../src/transaction
  ../src/ui/other
)
target_compile_definitions(test_pq_root PRIVATE
  HAVE_PQ_ROOT
  HAVE_NBGL
  TESTCASES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../tests/standalone/testcases"
)

add_executable(test_policy
  src/test_policy.c
  src/cx.c
  include/bolos_target.h
  include/cx.h
  include/os.h
)

target_link_libraries(test_printers PRIVATE cmocka crypto ssl xrp)
target_link_libraries(test_swap PRIVATE cmocka crypto ssl xrp)
target_link_libraries(test_tx PRIVATE cmocka crypto ssl xrp)
target_link_libraries(test_pq_root PRIVATE cmocka crypto ssl xrp)
target_link_libraries(test_policy PRIVATE cmocka crypto ssl xrp)

add_test(test_printers test_printers)
add_test(test_swap test_swap)
add_test(test_tx test_tx)
add_test(test_pq_root test_pq_root)
add_test(test_policy test_policy)
