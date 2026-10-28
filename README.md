# 一起造物 · 升级版

本地拍摄与真实代码扫描用独立源码。由本次Codex会话实现，未预设漏洞或检测结果。

运行：`python3 server.py`，需要Python 3.9+，仅使用标准库。

数据会在首次运行时初始化到local_data/，此目录不属于源码扫描包。升级版初始密码随机生成，见该目录的演示账号.txt。

服务仅监听127.0.0.1。本地HTTP会话cookie使用HttpOnly和SameSite=Strict；这不构成公开部署配置。

数据库SQL使用参数绑定；密码哈希使用scrypt。参考：
- https://docs.python.org/3.12/library/sqlite3.html
- https://docs.python.org/3.12/library/hashlib.html#hashlib.scrypt

扫描结果须在SecVibe平台实际取得，工具支持情况与提交方式以其实际界面为准。
