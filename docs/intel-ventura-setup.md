# Set up Nexus on your MacBook

For a 2017 Intel MacBook running macOS Ventura. Work through this together: one person types, the other checks each step.

**Your goal:** open Nexus, practise with simulated EEG, then save and reopen a short recording. You do not need a headset or an API key for these steps.

## 1. Check the Mac

Open Apple menu > About This Mac. You need an Intel processor and macOS 13.5 or later. Ventura 13.7.8 meets this minimum. Plug in the charger for software installation and use a reliable internet connection.

## 2. Install Python 3.13

Open the [Python 3.13 download page](https://www.python.org/downloads/release/python-31316/). Under Files, click **macOS installer**, open the downloaded package and follow its installer. Use the standard Python build; leave optional experimental/free-threaded options unselected.

## 3. Install Node 24

Download the [official Node 24 macOS installer](https://nodejs.org/dist/v24.21.0/node-v24.21.0.pkg), open the package and follow its installer. This package supports Intel Macs and includes npm. You do not need Homebrew.

## 4. Open Terminal and check Git

Press Command + Space, type Terminal and press Return. Type this command and press Return:

```bash
git --version
```

If the Mac offers to install Apple's Command Line Tools, finish that installation. If Git is missing without a prompt, run `xcode-select --install` and follow the installer. Then open a new Terminal window.

## 5. Check your installed versions

Run each line separately. Expect Python 3.13.x, Node v24.x and an npm version number.

```bash
python3.13 --version
node --version
npm --version
```

## 6. Download and install Nexus

Copy each line below into Terminal, pressing Return after each. Wait for the setup command to finish before running the last line. It can take several minutes.

```bash
mkdir -p ~/Documents
cd ~/Documents
git clone https://github.com/zook111/Nexus_BCI.git nexus
cd nexus
NEXUS_PYTHON=python3.13 ./script/setup.sh
./script/install_desktop_launcher.sh
```

Setup creates a local Python environment and installs the app's dependencies. The last command adds **Nexus Server** to your Desktop. Keep the nexus folder in Documents.

<!-- pagebreak -->

# Your first recording

Try this with simulated signals before connecting the headset.

## 7. Open Nexus

Double-click **Nexus Server** on the Desktop. It starts the local services and opens your browser. If the page does not open, visit [http://localhost:5173](http://localhost:5173). Keep the nexus folder in place; the launcher uses it.

## 8. Start simulated EEG

In **Console**, choose **Synthetic** as the board. Click **Connect**, then **Start**. You should see changing waveforms. These are simulated signals, not a person's brain data.

## 9. Save a short practice recording

Enter a session label such as **synthetic-practice**. Click **Record**, wait about 30 seconds, then click **Save**. Under **Telemetry**, find the saved session and open its preview. Download its CSV if you want a spreadsheet copy. Check that it contains timestamps and signal values.

## 10. Explore, then close the app

Open **Experiment Lab > How the classifier works** and try the interactive maths lesson. When finished, click **Stop** in Console. Double-click the Desktop's **Nexus Server** again to stop the local services. The Desktop app toggles them on and off.

## When you are ready for the headset

With your teacher or adult helper, follow the [OpenBCI Cyton setup guide](https://docs.openbci.com/GettingStarted/Boards/CytonGS/), including its electrical-safety instructions. Connect the OpenBCI USB dongle; the MacBook may need a USB-C to USB-A adapter.

Choose **Cyton** for 8 channels or **Cyton Daisy** for 16. Select the recommended USB serial port (usually /dev/cu.usbserial-... on macOS), then Connect and Start. Confirm fresh samples and several consecutive usable quality windows before calibration or experiments. Leave mains frequency at **50 Hz** in the UK.

Use participant codes and arrange permission with your teacher before collecting anyone's data. Keep raw recordings local; do not upload them to GitHub. Simulated classifier results do not show that real brain states can be classified.

## If something goes wrong

**Command not found:** reopen Terminal after installing Python and Node. Repeat step 5; reinstall the missing standard installer if needed.

**The nexus folder already exists:** do not delete it. Run `cd ~/Documents/nexus`, then the final two commands in step 6. If it belongs to a different project, ask for help first.

**The page will not load:** open Nexus Server once, allow a short startup wait and try the local link in step 7. Check that another Nexus instance is not already using ports 8000 or 5173.

**No headset serial port:** check the dongle and adapter, then Refresh the port list. Use Synthetic to check the software separately.

For screenshots and more troubleshooting, open the [Nexus README](https://github.com/zook111/Nexus_BCI#readme). For research reading and a first-week plan, use the [student research guide](https://github.com/zook111/Nexus_BCI/blob/main/docs/student-starter-guide.pdf).

**Verification note:** installer choices, dependency wheels and native-library targets were checked on 10 October 2026. Running Nexus on this exact Intel/Ventura MacBook and collecting physical-headset data still need the practical checks above.
