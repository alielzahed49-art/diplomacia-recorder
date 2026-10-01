# Diplomacia PC recorder

يفتح اللعبة في Chromium على جهازك ويسجّل كل طلبات الموقع الرسمي (هيدرز + status + شكل الرد + رسايل websocket)
ويبعتها لسيرفر البوت. أدق من سكربت Via لأنه بيشوف الهيدرز الفعلية وجسم ردود الـ403.

```
pip install playwright
playwright install chromium
python pc_recorder.py
```

أول مرة بيسأل عن المفتاح (لوحة الأدمن → سكربت الطلبات → نسخ المفتاح) ويحفظه في `key.txt`.
سجّل دخول (جوجل بيشتغل عادي لأنه Chrome الحقيقي) في النافذة، العب عادي، Ctrl+C للإيقاف. الـ Authorization والكوكيز بيتخبّوا قبل الإرسال.
