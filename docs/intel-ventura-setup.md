# Set up Dr K's EEG Lab on your MacBook

For a 2017 Intel MacBook running macOS Ventura. Work through this together: one person types, the other checks each step.

**Your goal:** open the app, practise with simulated EEG, then save and reopen a short recording. The desktop launcher is called **Nexus Server**. You do not need a headset or an API key for these steps.

## 1. Check the Mac

Open Apple menu > About This Mac. You need an Intel processor and macOS 13.5 or later. Ventura 13.7.8 meets this minimum. Plug in the charger for software installation and use a reliable internet connection.

## 2. Install Python 3.13

Open the [Python 3.13 download page](https://www.python.org/downloads/release/python-31316/). Under Files, click **macOS installer**, open the downloaded package and follow its installer. Use the standard Python build; leave optional experimental/free-threaded options unselected.

## 3. Install Node 24

Download the [official Node 24 macOS installer](https://nodejs.org/dist/v24.21.0/node-v24.21.0.pkg), open the package and follow its installer. This package supports Intel Macs and includes npm. You do not need Homebrew.

## 4. Meet Terminal and check Git

**Terminal** is an app already on the Mac. It lets you give the computer typed instructions, called **commands**. You do not need any coding experience to follow the commands in this guide.

1. Hold **Command** and press **Space** to open Spotlight search. Let go of the keys.
2. Type **Terminal**, then press **Return** to open it. You can also find it in **Finder > Applications > Utilities > Terminal**.
3. A window opens with some text and a cursor. The last line is the **prompt**, usually ending in `%` or `$`. It means Terminal is ready for a command. Your name or Mac's name may appear there; that is normal.

**How to enter each command:** click inside Terminal. Copy one complete command line from a code box in this guide with **Command + C**, paste it with **Command + V**, then press **Return** once. Paste into Terminal, rather than the browser's address bar. Do not copy the prompt, headings or code-box border marks.

Some commands print text; others finish silently. **Wait until the prompt returns before entering the next line.** Installation can take several minutes. Leave Terminal open while it is working. If an error appears, stop and show your helper the exact message instead of continuing with the next step.

Try your first command now:

```bash
git --version
```

You should see a line beginning `git version`, followed by another prompt. Git is the tool that downloads this project's files in step 6.

If the Mac offers to install Apple's Command Line Tools, finish that installation. If Git is missing without a prompt, enter `xcode-select --install` and follow the installer. After installation, choose **Shell > New Window** from Terminal's top menu, then try `git --version` again.

<!-- pagebreak -->

# Download the app

Keep following the steps in order. Python and Node run the app's software; you do not need to learn their programming languages to install it.

## 5. Check your installed versions

If you installed Python or Node while Terminal was open, choose **Shell > New Window** before checking. Enter each line below separately. Expect Python 3.13.x, Node v24.x and an npm version number. npm installs the browser interface's dependencies.

```bash
python3.13 --version
node --version
npm --version
```

## 6. Download and install Nexus

Copy each line below into Terminal, pressing Return after each. Wait for the prompt to return each time. If a line reports an error, stop there and ask your helper.

```bash
mkdir -p ~/Documents
cd ~/Documents
git clone https://github.com/zook111/Nexus_BCI.git nexus
cd nexus
NEXUS_PYTHON=python3.13 ./script/setup.sh
./script/install_desktop_launcher.sh
```

The commands create a folder in Documents, download the project and open its folder. `cd` means "change folder". `~/Documents` means the Documents folder for your Mac account. `cd nexus` puts Terminal inside the downloaded project, where the setup scripts live.

The `NEXUS_PYTHON=...` command installs the app's dependencies. It can print many lines and take several minutes. Do not enter the final launcher command until setup has finished successfully and the prompt returns. The final command adds **Nexus Server** to your Desktop. Keep the nexus folder in Documents.

**Opening Terminal another day?** A new window normally starts in your home folder. Before running a command described as "from the nexus folder", enter this line and wait for the prompt:

```bash
cd ~/Documents/nexus
```

Once installation is finished, you can normally open the app from the Desktop launcher without typing commands.

## Keep the app and guides updated

You will not need to type Git commands for everyday updates.

1. Finish and save your experiment and recording. Stop and Reset the board. Double-click **Nexus Server** to stop its services; closing the browser alone does not stop them.
2. Open **Nexus Server** again. If an update is offered, choose **Update and restart**, or **Not now** to use your installed version.
3. Keep the Mac awake and online while an update installs. This may take several minutes. The workspace opens when ready; recordings and local settings stay in place.

Offline checks still let the installed app open. No offer can mean the check was unavailable. Local code edits block updates rather than being discarded. If installation fails, the updater tries to reopen the previous version. If it asks for help, keep the app stopped and ask your helper. Do not delete the project folder or recovery copies.

Older installations need one helper-led source update and launcher reinstall to gain this feature. Fresh setup includes it.

<!-- pagebreak -->

# Your first recording

Try this with simulated signals before connecting the headset.

## 7. Open Nexus

Double-click **Nexus Server** on the Desktop. It starts the local services and opens your browser. If the page does not open, visit [http://localhost:5173](http://localhost:5173). Keep the nexus folder in place; the launcher uses it.

## 8. Start simulated EEG

In **Console**, choose **Synthetic** as the board. Click **Connect**, then **Start**. You should see changing waveforms. These are simulated signals, not a person's brain data.

## 9. Save a short practice recording

Enter a session label such as **synthetic-practice**. Click **Record** and wait about 30 seconds. Click **Capture setup** to store a signal-quality snapshot, then click **Save**. Save becomes available only after that snapshot. Under **Telemetry**, find the saved session and open its preview. Download its CSV if you want a spreadsheet copy. Check that it contains timestamps and signal values.

## 10. Explore, then close the app

Open **Experiment Lab > How the classifier works** and try the interactive maths lesson. When finished, click **Stop** in Console. Double-click the Desktop's **Nexus Server** again to stop the local services. The Desktop app toggles them on and off.

## When you are ready for the headset

With your teacher or adult helper, follow the [OpenBCI Cyton setup guide](https://docs.openbci.com/GettingStarted/Boards/CytonGS/), including its electrical-safety instructions. Connect the OpenBCI USB dongle; the MacBook may need a USB-C to USB-A adapter.

Choose **Cyton** for 8 channels or **Cyton Daisy** for 16. Select the recommended USB serial port (usually /dev/cu.usbserial-... on macOS), then Connect and Start. Confirm fresh samples and several consecutive usable quality windows before calibration or experiments. Leave mains frequency at **50 Hz** in the UK.

Use participant codes and arrange permission with your teacher before collecting anyone's data. Keep raw recordings local; do not upload them to GitHub. Simulated classifier results do not show that real brain states can be classified.

## If something goes wrong

**Command not found:** reopen Terminal after installing Python and Node. Repeat step 5; reinstall the missing standard installer if needed.

**The nexus folder already exists:** do not delete it. Run `cd ~/Documents/nexus`, then the final two commands in step 6. If it belongs to a different project, ask for help first.

**The page will not load:** if services are stopped, open Nexus Server once and allow startup time. If they are already running, reload the browser. Opening the launcher again stops running services. Try the local link in step 7.

**No headset serial port:** check the dongle and adapter, then Refresh the port list. Use Synthetic to check the software separately.

For screenshots and more troubleshooting, open the [Nexus README](https://github.com/zook111/Nexus_BCI#readme). For research reading and a first-week plan, use the [student research guide](https://github.com/zook111/Nexus_BCI/blob/main/docs/student-starter-guide.pdf).

**Verification note:** installer choices, dependency wheels and native-library targets were checked on 10 October 2026. Running Nexus on this exact Intel/Ventura MacBook and collecting physical-headset data still need the practical checks above.
