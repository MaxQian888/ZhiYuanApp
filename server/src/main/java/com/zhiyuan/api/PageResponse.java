package com.zhiyuan.api;

import java.util.List;

public record PageResponse<T>(List<T> items, int page, int size, long total, int totalPages) {
    public static <T> PageResponse<T> of(List<T> source, int page, int size) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(size, 1), 100);
        int from = Math.min((safePage - 1) * safeSize, source.size());
        int to = Math.min(from + safeSize, source.size());
        return new PageResponse<>(source.subList(from, to), safePage, safeSize, source.size(), (int) Math.ceil(source.size() / (double) safeSize));
    }
}
