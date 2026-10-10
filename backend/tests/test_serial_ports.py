from serial.tools.list_ports_common import ListPortInfo

from mindmeld_api.services.serial_ports import describe_serial_port


def make_port(
    device: str,
    description: str | None = None,
    manufacturer: str | None = None,
) -> ListPortInfo:
    port = ListPortInfo(device)
    port.description = description
    port.manufacturer = manufacturer
    return port


def test_openbci_usb_callout_port_is_recommended() -> None:
    port = describe_serial_port(
        make_port(
            "/dev/cu.usbserial-DM0258KQ",
            description="FT231X USB UART",
            manufacturer="FTDI",
        )
    )

    assert port.recommended is True
    assert port.transport == "usb"
    assert port.rank >= 50
    assert port.message == "Recommended OpenBCI candidate"


def test_bluetooth_port_is_not_recommended() -> None:
    port = describe_serial_port(
        make_port(
            "/dev/cu.Bluetooth-Incoming-Port",
            description="Bluetooth-Incoming-Port",
            manufacturer="n/a",
        )
    )

    assert port.recommended is False
    assert port.transport == "bluetooth"
    assert port.rank < 50


def test_tty_variant_is_not_recommended_even_for_usb_serial() -> None:
    port = describe_serial_port(
        make_port(
            "/dev/tty.usbserial-DM0258KQ",
            description="FT231X USB UART",
            manufacturer="FTDI",
        )
    )

    assert port.recommended is False
    assert port.transport == "usb"


def test_generic_usb_serial_port_is_not_recommended_without_openbci_hint() -> None:
    port = describe_serial_port(
        make_port(
            "/dev/cu.usbmodem1101",
            description="USB Serial Device",
            manufacturer="Arduino",
        )
    )

    assert port.recommended is False
    assert port.transport == "usb"
    assert port.rank >= 50
    assert port.message == "USB serial port"
