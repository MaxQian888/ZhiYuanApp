package com.zhiyuan.api;

import com.zhiyuan.domain.Models;
import com.zhiyuan.service.PlatformStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/goods")
public class GoodsController {
    public record GoodsRequest(@NotBlank String name,@NotBlank String category,@NotNull BigDecimal price,int stock,double weight,int status){}
    public record BatchRequest(Set<Long> ids){}
    private final PlatformStore store;
    public GoodsController(PlatformStore store){this.store=store;}
    @GetMapping public ApiResponse<PageResponse<Models.Goods>> list(@RequestParam(defaultValue="")String q,@RequestParam(defaultValue="")String category,@RequestParam(defaultValue="1")int page,@RequestParam(defaultValue="20")int size){return ApiResponse.ok(PageResponse.of(store.goods(q,category),page,size));}
    @GetMapping("/statistics") public ApiResponse<Map<String,Long>> statistics(){return ApiResponse.ok(store.goods("","").stream().collect(Collectors.groupingBy(Models.Goods::category,Collectors.counting())));}
    @PostMapping public ApiResponse<Models.Goods> create(@Valid @RequestBody GoodsRequest body){return ApiResponse.ok(store.addGoods(body.name(),body.category(),body.price(),body.stock(),body.weight(),body.status()));}
    @PutMapping("/{id}") public ApiResponse<Models.Goods> update(@PathVariable long id,@Valid @RequestBody GoodsRequest body){return ApiResponse.ok(store.updateGoods(id,body.name(),body.category(),body.price(),body.stock(),body.weight(),body.status()));}
    @PatchMapping("/{id}/status") public ApiResponse<Models.Goods> toggle(@PathVariable long id){return ApiResponse.ok(store.toggleGoods(id));}
    @DeleteMapping("/{id}") public ApiResponse<Void> delete(@PathVariable long id){store.deleteGoods(id);return ApiResponse.ok(null);}
    @DeleteMapping public ApiResponse<Void> batch(@RequestBody BatchRequest body){store.deleteGoods(body.ids());return ApiResponse.ok(null);}
}
