from serial.tools import list_ports
from serial.tools.list_ports_common import ListPortInfo

from mindmeld_api.schemas import SerialPortInfo

OPENBCI_HINTS = ("openbci", "ftdi", "ft231", "ft232")


def list_serial_ports() -> list[SerialPortInfo]:
    ports: list[SerialPortInfo] = []
    for port in list_ports.comports():
        ports.append(describe_serial_port(port))
    return sorted(ports, key=lambda candidate: (-candidate.rank, candidate.device))


def describe_serial_port(port: ListPortInfo) -> SerialPortInfo:
    device = port.device or ""
    name = port.name
    description = port.description
    manufacturer = port.manufacturer
    serial_number = port.serial_number
    haystack = " ".join(
        value.lower()
        for value in (device, name, description, manufacturer, serial_number)
        if value
    )

    rank = 0
    transport = "unknown"
    message = "Serial device"

    if device.startswith("/dev/cu."):
        rank += 40
        message = "macOS callout port"
    elif device.startswith("/dev/tty."):
        rank -= 20
        message = "macOS tty port"

    if "bluetooth" in haystack:
        rank -= 30
        transport = "bluetooth"
        message = "Bluetooth serial port"
    elif "usb" in haystack or device.startswith(("/dev/cu.usb", "/dev/tty.usb")):
        rank += 20
        transport = "usb"
        message = "USB serial port"

    has_openbci_hint = any(hint in haystack for hint in OPENBCI_HINTS)
    if has_openbci_hint:
        rank += 25
        message = "Likely OpenBCI USB dongle"

    recommended = (
        has_openbci_hint
        and rank >= 50
        and transport != "bluetooth"
        and device.startswith("/dev/cu.")
    )
    if recommended:
        message = "Recommended OpenBCI candidate"

    return SerialPortInfo(
        device=device,
        name=name,
        description=description,
        manufacturer=manufacturer,
        serial_number=serial_number,
        transport=transport,
        recommended=recommended,
        rank=rank,
        message=message,
    )
