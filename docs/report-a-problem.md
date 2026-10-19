# Report a problem on GitHub

Use this guide to send Karl a report he can investigate. You can do everything in your browser. No Terminal, Git commands, or coding are needed.

GitHub is the website that stores this project's code. An **issue** is a conversation about a problem, question, or idea. You do not need to fix the code yourself.

## 1. Save your work and check what you can share

Finish and save your recording or experiment if the app still allows it. If samples have frozen or the signal is poor, pause data collection. Do not repeat a participant experiment just to reproduce a software problem.

**This repository and its issues are public. Anyone can read them.** Leave out names, faces, school or contact details, passwords, API keys, and your Mac's serial number. Keep participant recordings, EEG exports, completed session sheets, and participant results private, even if they use participant codes.

Before sharing a screenshot, crop it to the relevant controls or error. Check browser tabs, notifications, file paths, and recording labels. Use simulated data for a screenshot if possible. Never upload `.env` files or whole log folders. If the problem involves private information or a possible security flaw, tell Karl privately instead of opening a public issue.

## 2. Sign in and look for an existing report

1. Open the [Nexus_BCI issues page](https://github.com/zook111/Nexus_BCI/issues).
2. Sign in to GitHub. If you do not have an account, ask your parent or teacher to help you create one or submit the report for you. Never share an account password.
3. Search for a few words from your problem, such as `Connect` or `no sound`. Check closed issues too.
4. If someone has reported the same problem, open that issue. Add a comment with any new details instead of creating a duplicate. Check that the steps and symptoms actually match.

## 3. Fill in a report

1. Click **New issue**. You can also use **Report a problem** in the app's Help tab.
2. Choose **Report a problem** if something appears broken. Choose **Ask a question or suggest an improvement** if you need an explanation or want a change.
3. Write a specific title, such as `Synthetic recording does not appear after Save`.
4. Fill in the form. Describe the buttons you clicked, what you expected, and what actually happened. Copy the exact error if you can share it safely. `I'm not sure` is a useful answer when you do not know a detail.
5. Include your Mac model, macOS version, and browser name/version if known. Find the Mac model and macOS version under **Apple menu → About This Mac**. Copy the model and version only, without the serial number. Say whether you used Synthetic or the headset. The **API connected** indicator is connection status, not an app release number.
6. If you have a safe screenshot, attach it to the form's optional evidence field. You can drag the image into that text box. For a cropped Mac screenshot, press **Shift + Command + 4** and drag around the relevant area. Check the saved image before attaching it.
7. Review the whole report and confirm that it contains no private information.
8. Click **Submit new issue**. GitHub may show **Create** instead. The finished report has an issue number, such as `#23`. Copy its link for your teammate.

You do not need to choose labels, assign people, make a branch, or open a pull request. Internet access is needed to submit an issue. If you are offline, keep a private note and submit it later.

## A fictional example using simulated data

> **Title:** Synthetic recording does not appear after Save
>
> **Steps:** 1. Open Console. 2. Choose Synthetic, then Connect and Start. 3. Click Record. 4. Wait 20 seconds, then click Save.
>
> **Expected:** The practice recording appears in the saved recordings list.
>
> **Actual:** The list stays empty. No error is visible. This happened twice.
>
> **Setup:** MacBook Retina 12-inch, 2017; macOS Ventura 13.7.8; Chrome, version not known; Synthetic. Last app update not known.
>
> **Already tried:** Reloaded the page once. No participant data was used.

This is an example of how to describe a problem, not a known bug or an instruction to submit a practice issue.

## 4. Return to the same issue for replies

Bookmark the issue and check it again later. GitHub may also send notifications, depending on your account settings. Karl may ask for another detail or give you steps to try.

After a fix, save your work and use the launcher's **Update and restart** offer. Repeat the relevant steps with Synthetic where possible. Reply on the same issue with `Fixed after updating` or explain what still happens. A closed issue usually means the maintainer considers it resolved; if the problem remains, reply there so Karl can reassess it.

GitHub's [guide to creating an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue) has more detail about its interface.
