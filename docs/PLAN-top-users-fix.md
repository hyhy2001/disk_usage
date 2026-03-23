# PLAN: Fix Other Users Not Showing in Top Consuming Users Chart

## Root Cause

`dataStore.js` lưu data vào **2 Map riêng biệt**:
- `userUsageMap` ← từ `report.user_usage` (user1…user20)
- `otherUsageMap` ← từ `report.other_usage` (nginx, daemon, mysql…)

Nhưng `getTopUsers()` **chỉ đọc `userUsageMap`**, bỏ qua `otherUsageMap` hoàn toàn:

```js
// dataStore.js dòng 183–188 — hiện tại
getTopUsers(limit = 10) {
    return Array.from(this.userUsageMap.entries())  // ← otherUsageMap bị bỏ qua!
        .map(([name, used]) => ({ name, used }))
        .sort((a, b) => b.used - a.used)
        .slice(0, limit);
}
```

---

## Thay đổi đề xuất

### [MODIFY] [dataStore.js](file:///www/wwwroot/disk.hydev.me/disk_usage/js/dataStore.js)

Cập nhật `getTopUsers()` để merge cả `userUsageMap` và `otherUsageMap`:

```js
getTopUsers(limit = 10) {
    const combined = new Map([...this.userUsageMap, ...this.otherUsageMap]);
    return Array.from(combined.entries())
        .map(([name, used]) => ({ name, used }))
        .sort((a, b) => b.used - a.used)
        .slice(0, limit);
}
```

> Nếu `otherUsageMap` có user trùng tên với `userUsageMap`, Map spread sẽ lấy giá trị của `otherUsageMap` (sau). Thực tế không bao giờ trùng vì other_users là system accounts.

---

## Ảnh hưởng đến các hàm khác

`getTopUsersByTotal()` và `getTopUsersByGrowth()` dùng `userTimelineMap`. Trong `dataStore.js` dòng 100–101, `other_usage` đã được push vào `userTimelineMap` → **hai hàm đó đã hoạt động đúng**, chỉ có `getTopUsers()` bị lỗi.

---

## Verification Plan

### Tự động — kiểm tra bằng browser

1. Reload `https://disk.hydev.me`
2. Xem chart **"Top Consuming Users"**
3. ✅ Phải thấy các tên như `nginx`, `daemon`, `mysql`... xuất hiện nếu usage của họ nằm trong top 10
