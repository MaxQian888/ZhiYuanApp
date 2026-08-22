package com.zhiyuan.fulfilment;

/** One requested product and quantity on a new order. */
public record OrderLine(long goodsId, int count) {
    public OrderLine {
        if (count <= 0) throw new IllegalArgumentException("Order line count must be positive");
    }
}
