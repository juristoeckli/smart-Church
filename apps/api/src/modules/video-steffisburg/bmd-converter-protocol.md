# DS-700 / SX Virtual Link protocol notes

This documents the observed network-side protocol used by the Video module to reach one Blackmagic Mini Converter Audio to SDI through a Silex DS-700. It is based on the supplied packet captures. The USB side was not captured; the converter requests below are visible only as USB control transfers tunneled over TCP.

## Roles and flow

The DS-700 is the USB server. The client first discovers the attached converter over UDP, identifies itself in a USB attach request, then opens a TCP tunnel to the DS-700. USB control transfers are carried inside that TCP stream. SX Virtual Link performs this attach/tunnel role; the captured client identity includes the client MAC and IPv4 address.

```text
client --UDP--> DS-700: USB device list (and list acknowledgement)
client --UDP--> DS-700: USBDS_CONNECTINFO attach (and attach acknowledgement)
client --TCP--> DS-700: USB control transfer tunnel
client --UDP--> DS-700: optional server info (separate exchange)
```

The supplied Windows installer is SX Virtual Link `5.2.1` (Silex Technology). Static inspection of the embedded files shows `Svlscapi.dll` (`4.2.1`, described as the SX Virtual Link Service Control API) and `SXUPTP` driver `4.0.2.0`. Its INF registers `SXUPTP` as a kernel driver in the `VHCI` load-order group. The included user guide says a successful connect triggers Windows Plug and Play and makes the USB device available to Windows applications. This is the local virtual-USB layer that the desktop client adds on top of the network attach/tunnel.

The DLL's exported names reveal its major operations without exposing their private implementation: `SvlEnumServers`, `SvlEnumUsbDevices`, `SvlGetUsbDeviceInfo`, `SvlConnectUsbDevice`, `SvlDisconnectUsbDevice`, `SvlForceDisconnect`, ownership/request-use functions, and service start/suspend/resume/renew functions. Its embedded log strings identify device-list protocol generations `GET USB_DEVICE_LIST`, `_EX`, `_EX_II`, `_III`, and `_IV`, plus keepalive/renewal and disconnect handling. This confirms that the current capture covers one part of a wider client protocol; the precise request formats and state transitions for these additional operations remain unknown.

The Smart-Church worker currently implements the network attach/tunnel and the converter control requests itself. It does not create a Windows virtual USB device, install `SXUPTP`, or make Blackmagic's Windows setup application see the converter as a locally attached USB device. That driver layer would only be needed if local Windows software must access the remote USB device through normal Windows Plug and Play.

For checks without the web application or API server, run `pnpm --filter @smart-church/api test:converter discover`, `read`, or `read-levels`. `set <raw-level>` writes the AES/EBU control. `set-analog-levels <ch1> <ch2> <ch3> <ch4>` writes all four analog controls. Both write commands verify the values by reading them back.

## Capture truncation and live validation

The gateway captures save at most 128 bytes per Ethernet frame. With ordinary Ethernet/IPv4/UDP headers, only 86 payload bytes survive. Earlier notes incorrectly treated this saved prefix as the complete datagram and attributed failures to client/session interference. Compare PCAP captured length with original frame length and the UDP length field before decoding any request. Identical saved prefixes do not establish identical wire packets.

The current discovery builder uses 88-byte requests, with the recovered word `02 00` at offsets 86–87 for device-list messages. With both SX Virtual Link clients closed, discovery succeeded. The initial read then failed because the VPN interface `utun` exposes no MAC. The successful SX capture's MAC `9c:5c:8e:00:c7:ac` was verified against this computer's Intel Ethernet adapter and supplied using the existing override.

The 86-byte attach builder still timed out. Changing attach to 510 bytes and its acknowledgement to 88 bytes, with `02 00` at offsets 86–87, produced a successful standalone worker read on 2026-10-26: discovery, attach, TCP USB initialization, and AES level readback `0`. Bytes 88–509 of the attach request were zero-filled as an inference consistent with both captured checksums; the successful live test establishes that this constructed request works with this DS-700, not that every omitted SX byte was recovered. No AES setting write was performed in this validation. Discovery framing had also changed, so success after closing SX clients alone does not establish client interference as the earlier cause.

## UDP discovery

The server-info probe is 88 bytes, established by the UDP length field, although only 86 payload bytes were saved. Its first four bytes are `00 04 95 06`; the reply identifies the DS-700 and reports firmware `Ver 2.7.0` in the captured exchange.

The device-list request is 88 bytes. It begins `00 01 00 01`, followed at offset 4 by ASCII `GET USB_DEVICE_LIST_III`, and ends with `02 00` at offsets 86–87 (recovered from the UDP checksum). The reply names the attached port (`usb1-002:0`) and `Blackmagic Design Mini Converter Audio to SDI`. The list acknowledgement begins `00 03 00 01`, repeats the command, and copies the 16-bit value from reply offset 6 to request offsets 84–85, retaining `02 00` at offsets 86–87. The DS-700 replies with an 8-byte acknowledgement beginning `00 03 00 00`.

The later Sonnenhof capture `1793059331659` shows that device-list results are paginated. Requests advance the cursor at offsets 84–85 by the previous page length (normally `0x0200`); the terminal response has status `0000` and a shorter page length. The client acknowledges the final cursor after collecting all pages. The worker now follows those pages before selecting the Audio to SDI USB port. The capture's 128-byte snap length truncates the 520-byte list datagrams, but the full UDP length fields and cursor values are visible.

The worker performs the device-list request and acknowledgement on one UDP socket, then probes optional server info on another socket. The list lookup retries at two-second intervals, for up to five seconds. The capture shows SX Virtual Link using distinct UDP source ports for the device-list, attach, and server-info exchanges; each request and its acknowledgement share a source port. The worker follows that socket lifetime pattern.

## SX Virtual Link attach

The attach request is a 510-byte UDP payload (UDP length 518), beginning with a 16-bit sequence and `00 01`. Its ASCII command is `GET USBDS_CONNECTINFO:`. The command is followed by `02 06`, the six-byte client MAC, four client IPv4 bytes, the NUL-terminated device name `usb1-002:0`, and `LT`. The first request uses sequence 1 and receives a reply containing `OK`. The client repeats the attach identity in an 88-byte acknowledgement with sequence 3, `04 03` at offsets 84–85, and the checksum-recovered `02 00` at offsets 86–87. The initial attach's omitted 424 bytes have the same one's-complement sum (`0x0200`) in two successful captures. The worker places `02 00` at offsets 86–87 and zero-fills the remaining tail; this construction has now passed the live attachment/read test. The attach exchange uses its own UDP socket.

The worker derives the IPv4 address by routing a UDP probe toward the configured DS-700. It uses the MAC for that interface; `BMD_CONVERTER_CLIENT_MAC` can override the MAC where the operating system does not expose it reliably.

## TCP USB tunnel

After attach, the client opens TCP to the configured DS-700 port (default `19540`). Each observed USB control request has a 12-byte tunnel header, an 8-byte USB setup packet, a 2-byte transfer length, and optional OUT data. Captured requests use the header fields `0001`, `0200`, `0215`, `0008`; the first header word varies with transfer direction/type. The worker tracks the 16-bit request sequence.

The observed response starts with a six-byte zero transport acknowledgement, followed by a 10-byte response header containing the request sequence, status, and response-data length. IN transfer bytes follow that header. The worker checks the ACK, sequence, and status before returning data.

## Converter control observed

The captured initialization reads USB descriptors, clears endpoint feature state, and issues vendor control requests, including `c1 10`, `41 50`, `c1 53`, and `c1 11`.

All observed audio-level reads use vendor IN request `c1 53`, one byte; writes use vendor OUT request `41 52`, four bytes of little-endian level data. The register values map to the controls as follows:

The Sonnenhof capture also contains repeated Audio to SDI writes to register `0x0024`, with four-byte little-endian values `1, 13, 24, 30, 33, 36, 35, 17, 3, 0` while a slider was moved and returned to its starting value. This confirms the AES/EBU write format for this device. It does not establish a complete raw-code-to-dB curve.

For the captured control transfer, the USB setup bytes are `[bmRequestType, bRequest, wValue LE, wIndex LE, wLength LE]`. A level read is `c1 53 <register LE> 00 00 01 00`; a level write is `41 52 <register LE> 00 00 04 00` followed by the raw level as a 32-bit little-endian integer. The worker sends writes sequentially and verifies each by reading that register back.

| Register | Control | Live raw value | Blackmagic Setup display |
| --- | --- | ---: | ---: |
| `0x0014` | Analog Ch 1 | 101 | +3.96 dB |
| `0x0018` | Analog Ch 2 | 101 | +3.96 dB |
| `0x001c` | Analog Ch 3 | 64 | 0.00 dB |
| `0x0020` | Analog Ch 4 | 64 | 0.00 dB |
| `0x0024` | AES/EBU | 255 | +12.00 dB |

The register-to-channel mapping and raw values were confirmed by reading all five registers while they matched the user's Blackmagic Setup screenshot. Earlier controlled captures show raw `0` at the AES/EBU minimum and raw `255` at its +12.00 dB maximum. The conversion curve from raw code to dB between these observed points has not been established; the Setup UI shows dB labels beside sliders. Analog Ch 1/2 were then set to raw `101` and Ch 3/4 to raw `64`; all four readbacks matched. These codes correspond to +3.96 dB on Ch 1/2 and 0.00 dB on Ch 3/4 in the screenshot.

## SDI to Audio converter

Capture `1793063514230` contains two TCP USB sessions to the Sonnenhof DS-700. USB string descriptors identify client port `59526` as `Blackmagic Design Mini Converter SDI to Audio` and client port `59540` as `Blackmagic Design Mini Converter Audio to SDI`; the truncated UDP device-list prefixes expose only the latter name.

The SDI-to-Audio session clears endpoint `0x02`, then reads vendor request `0xC0/0xE1`. Its level reads use request `0xC0/0xD6`, with channel registers `0x0500`, `0x0600`, `0x0700`, `0x0800`, and AES/EBU at `0x0900`. The captured AES read returned `0xFF` before a slider movement. During the movement, no-data writes use request `0x40/0xD7`; their `wIndex` values descend through `0x09FD`, `0x09EF`, …, `0x0900`. This supports the mapping `wIndex = 0x0900 + raw AES level`; analog writes use the same inferred encoding at their respective `0x0500`–`0x0800` channel bases. The intermediate raw-to-dB curve remains unknown.

Capture `1792993635333` contains simultaneous SX queries from `192.168.2.4:60728` and worker queries from `192.168.2.4:53346`. SX receives replies and the old worker does not. Their saved 86-byte prefixes match, but SX's UDP header declares an 88-byte payload while the old worker declares 86 bytes. SX traffic from `192.168.20.5` and an existing TCP session from `.2.4:23630` are also present; these observations do not establish that another client caused the timeout. The missing discovery suffix and undersized attach request were concrete implementation errors exposed by checking original packet lengths.

## Unknowns and scope

- No USB-side capture is available, so the internal control protocol is reconstructed only from tunneled network payloads.
- Other SX Virtual Link behavior (disconnect/release packets, keepalive payloads, concurrent clients, error codes, reconnect behavior, and other device classes) has not been mapped. The installer strings expose operation names, not the packet formats or their state transitions.
- The installer confirms a VHCI driver and service-control API are involved on Windows, but their private control interface and how it coordinates remote USB transfers are not decoded here.
- Only one DS-700 firmware is evidenced by these captures.
- SDI-to-Audio read registers were captured; its AES setter encoding is inferred from the `0x40/0xD7` slider trace, and the analog setter mapping has not been independently captured.
- The raw-code-to-dB curve between observed endpoints remains unknown for both converter models.

## Firmware archive inspection

The supplied `DS-700_2_1_0.zip` contains the vendor update guide and a `DS-700.bin` image. The guide says DS-700 firmware is applied through the device server's web interface, with HTTPS enabled beforehand. The image has a `.VUP` header, a `DS-700AC` family tag, and a `2.1.0` version string; the rest of the payload is high-entropy and exposed no readable network or USB protocol strings in a static scan. This did not add wire-protocol details.

The packet-capture notes report a server response containing `Ver 2.7.0`, while this archive is labelled `2.1.0`. Those may be different version fields, but they should be compared with the version shown by the actual DS-700 before using this image as a firmware reference.
