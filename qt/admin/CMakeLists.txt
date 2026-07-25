cmake_minimum_required(VERSION 3.16)
project(MuteGameAdmin VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

# Required: Quick + Network + Multimedia + WebSockets. Without WebSockets the
# admin can't receive `clients:update` / `credits:update` from the server in
# real time, leaving the operator looking at stale data — fail loudly instead.
find_package(Qt6 6.4 REQUIRED COMPONENTS Quick QuickControls2 Network Multimedia WebSockets)

# qt_standard_project_setup is the modern way to wire AUTOMOC etc.
qt_standard_project_setup(REQUIRES 6.4)

set(SOURCES
    src/main.cpp
    src/ApiClient.cpp
    src/Currency.cpp
    src/ExpenseStore.cpp
    src/Jalali.cpp
    src/SocketClient.cpp
    src/VoiceCapture.cpp
    src/ServerProcess.cpp
    src/NetworkInfo.cpp
)
set(HEADERS
    src/ApiClient.h
    src/Currency.h
    src/ExpenseStore.h
    src/Jalali.h
    src/SocketClient.h
    src/VoiceCapture.h
    src/ServerProcess.h
    src/NetworkInfo.h
)

qt_add_executable(MuteGameAdmin
    ${SOURCES} ${HEADERS}
    resources/qml.qrc
)

target_link_libraries(MuteGameAdmin PRIVATE
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::Network
    Qt6::Multimedia
    Qt6::WebSockets
)
target_compile_definitions(MuteGameAdmin PRIVATE HAVE_WEBSOCKETS=1)

if(WIN32)
    set_target_properties(MuteGameAdmin PROPERTIES WIN32_EXECUTABLE TRUE)
endif()
